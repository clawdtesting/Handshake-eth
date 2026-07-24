// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Handshake} from "../src/Handshake.sol";
import {MockERC721} from "./mocks/MockERC721.sol";
import {MaliciousProxy721} from "./mocks/MaliciousProxy721.sol";

/// @notice Executable proof of the ONE residual risk tests and static analysis
///         cannot design away: the allowlist assumes every listed collection is
///         honest AND immutable. That holds for a standard, non-upgradeable
///         ERC-721. It does NOT hold for an upgradeable proxy, whose owner can
///         swap in a lying `ownerOf` AFTER it has been allowlisted — reopening
///         the exact fund-loss vector the allowlist was built to close.
///
///         These tests show, end to end:
///           1. The proxy behaves honestly and settles a real trade — how it
///              earns its allowlist slot.
///           2. After a malicious "upgrade", an allowlisted proxy lets a maker
///              take the taker's real NFT while the proxy token never moves —
///              a theft, while still on the allowlist.
///           3. The operational defense: instant removeCollection kills it in
///              the same block. The deeper defense (in the audit notes) is to
///              never allowlist an upgradeable collection in the first place,
///              since detection can come too late.
contract HandshakeUpgradeableRisk is Test {
    Handshake internal hs;

    uint256 internal constant MAKER_PK = 0xA11CE;
    uint256 internal constant TAKER_PK = 0xB0B;
    address internal maker;
    address internal taker;
    address internal feeRecipient = address(0xFEE);

    MaliciousProxy721 internal proxy; // upgradeable, allowlisted collection (maker side)
    MockERC721 internal realCol; // honest collection (taker side)

    uint256 internal constant PROXY_TOKEN = 1;
    uint256 internal constant REAL_TOKEN = 2;

    function setUp() public {
        vm.warp(1_000_000);
        maker = vm.addr(MAKER_PK);
        taker = vm.addr(TAKER_PK);

        address[] memory noSeed;
        hs = new Handshake(address(this), feeRecipient, noSeed);

        proxy = new MaliciousProxy721();
        realCol = new MockERC721("Real", "REAL");
        proxy.mint(maker, PROXY_TOKEN);
        realCol.mint(taker, REAL_TOKEN);

        // Both parties approve while everything is honest.
        vm.prank(maker);
        proxy.setApprovalForAll(address(hs), true);
        vm.prank(taker);
        realCol.setApprovalForAll(address(hs), true);

        // Owner allowlists both after inspecting them (proxy looks honest here).
        _allowNow(address(proxy));
        _allowNow(address(realCol));
    }

    function _allowNow(address c) internal {
        hs.proposeCollection(c);
        vm.warp(block.timestamp + hs.ADD_DELAY());
    }

    function _order(uint256 nonce) internal view returns (Handshake.TradeOrder memory order) {
        Handshake.NFTItem[] memory makerNFTs = new Handshake.NFTItem[](1);
        makerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(proxy), tokenId: PROXY_TOKEN, amount: 1});
        Handshake.NFTItem[] memory takerNFTs = new Handshake.NFTItem[](1);
        takerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(realCol), tokenId: REAL_TOKEN, amount: 1});

        order = Handshake.TradeOrder({
            maker: maker,
            taker: address(0),
            makerNFTs: makerNFTs,
            takerNFTs: takerNFTs,
            makerEthAmount: 0,
            takerEthAmount: 0,
            feeBps: 100,
            flatFee: 0,
            nonce: nonce,
            expiry: block.timestamp + 1 days
        });
    }

    function _sign(Handshake.TradeOrder memory order) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, hs.hashOrder(order));
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------------
    // 1. Honest phase: the proxy settles a real trade (earns its allowlist slot)
    // ---------------------------------------------------------------------

    function test_HonestProxy_SettlesRealTrade() public {
        assertFalse(proxy.lying(), "proxy honest at listing time");

        Handshake.TradeOrder memory order = _order(1);
        bytes memory sig = _sign(order);
        vm.prank(taker);
        hs.fulfillTrade(order, sig);

        // Real ownership actually changed hands both ways.
        assertEq(proxy.trueOwnerOf(PROXY_TOKEN), taker, "proxy NFT really moved to taker");
        assertEq(realCol.ownerOf(REAL_TOKEN), maker, "real NFT moved to maker");
    }

    // ---------------------------------------------------------------------
    // 2. The break: after a malicious upgrade, the allowlisted proxy enables theft
    // ---------------------------------------------------------------------

    function test_UpgradedProxy_StealsTakerNFT_WhileStillAllowlisted() public {
        // The collection owner "upgrades" to a lying implementation AFTER being
        // allowlisted. ownerOf now reports maker before the transfer and taker
        // after, while the transfer moves nothing.
        proxy.setLying(true, maker, taker);
        assertTrue(hs.isCollectionAllowed(address(proxy)), "still on the allowlist");

        Handshake.TradeOrder memory order = _order(2);
        bytes memory sig = _sign(order);

        // The trade settles: every runtime guard is satisfied by the lie.
        vm.prank(taker);
        hs.fulfillTrade(order, sig);

        // THEFT: the maker received the taker's real NFT, but the proxy token
        // never actually moved — the maker still truly owns it. The taker gave
        // up a real asset for nothing.
        assertEq(realCol.ownerOf(REAL_TOKEN), maker, "maker took the taker's real NFT");
        assertEq(proxy.trueOwnerOf(PROXY_TOKEN), maker, "proxy token never left the maker");
        // Handshake's post-transfer check was fooled: ownerOf lies that it moved.
        assertEq(proxy.ownerOf(PROXY_TOKEN), taker, "lying ownerOf claims taker owns it");
    }

    // ---------------------------------------------------------------------
    // 3. The operational defense: instant removal kills it in the same block
    // ---------------------------------------------------------------------

    function test_Mitigation_RemoveCollection_InstantlyStopsTheft() public {
        proxy.setLying(true, maker, taker);

        // The moment the owner (ideally a multisig watching CollectionProposed /
        // on-chain behavior) detects it, removeCollection is instant.
        hs.removeCollection(address(proxy));
        assertFalse(hs.isCollectionAllowed(address(proxy)), "removed instantly");

        Handshake.TradeOrder memory order = _order(3);
        bytes memory sig = _sign(order);

        vm.expectRevert(
            abi.encodeWithSelector(Handshake.CollectionNotAllowed.selector, address(proxy))
        );
        vm.prank(taker);
        hs.fulfillTrade(order, sig);

        // Nothing moved.
        assertEq(realCol.ownerOf(REAL_TOKEN), taker, "taker keeps real NFT after removal");
        assertEq(proxy.trueOwnerOf(PROXY_TOKEN), maker, "proxy token still with maker");
    }
}
