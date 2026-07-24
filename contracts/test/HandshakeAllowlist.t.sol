// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Handshake} from "../src/Handshake.sol";
import {MockERC721} from "./mocks/MockERC721.sol";
import {LyingERC721} from "./mocks/LyingERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Unit tests for the owner-managed, asymmetrically-timelocked
///         collection allowlist added to Handshake. Covers the happy path, the
///         timelock semantics (pending / boundary / instant removal), the lying
///         -collection exclusion, access control, the AlreadyAllowed guard,
///         constructor seeding, events, and multi-item atomicity.
contract HandshakeAllowlistTest is Test {
    Handshake internal hs;

    // Signing identities.
    uint256 internal constant MAKER_PK = 0xA11CE;
    uint256 internal constant TAKER_PK = 0xB0B;
    address internal maker;
    address internal taker;
    address internal feeRecipient = address(0xFEE);

    MockERC721 internal colA; // maker-side collection
    MockERC721 internal colB; // taker-side collection

    uint256 internal constant TOKEN_A = 1;
    uint256 internal constant TOKEN_B = 2;

    // Re-declared here so vm.expectEmit can match on Handshake's emissions.
    event CollectionProposed(address indexed collection, uint256 allowedAt);
    event CollectionRemoved(address indexed collection);
    event TradeExecuted(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerEthAmount,
        uint256 takerEthAmount,
        uint256 protocolFee
    );

    function setUp() public {
        maker = vm.addr(MAKER_PK);
        taker = vm.addr(TAKER_PK);

        // Deploy with the test contract as owner and no seeded collections; each
        // test allowlists what it needs. Start at a non-zero timestamp so
        // block.timestamp - 1 boundary math never underflows.
        vm.warp(1_000_000);
        address[] memory noSeed;
        hs = new Handshake(address(this), feeRecipient, noSeed);

        colA = new MockERC721("A", "A");
        colB = new MockERC721("B", "B");
        colA.mint(maker, TOKEN_A);
        colB.mint(taker, TOKEN_B);

        // Approve settlement to move each side's token.
        vm.prank(maker);
        colA.setApprovalForAll(address(hs), true);
        vm.prank(taker);
        colB.setApprovalForAll(address(hs), true);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /// @dev Propose then warp past ADD_DELAY so `c` is live in the current block.
    function _allowNow(address c) internal {
        hs.proposeCollection(c);
        vm.warp(block.timestamp + hs.ADD_DELAY());
    }

    /// @dev A single-item-per-side NFT<->NFT order, colA(TOKEN_A) for colB(TOKEN_B),
    ///      with an optional maker ETH leg funded from escrow.
    function _order(uint256 makerEth, uint256 nonce)
        internal
        view
        returns (Handshake.TradeOrder memory order)
    {
        Handshake.NFTItem[] memory makerNFTs = new Handshake.NFTItem[](1);
        makerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colA), tokenId: TOKEN_A, amount: 1});
        Handshake.NFTItem[] memory takerNFTs = new Handshake.NFTItem[](1);
        takerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colB), tokenId: TOKEN_B, amount: 1});

        order = Handshake.TradeOrder({
            maker: maker,
            taker: address(0), // open order
            makerNFTs: makerNFTs,
            takerNFTs: takerNFTs,
            makerEthAmount: makerEth,
            takerEthAmount: 0,
            feeBps: 100, // 1%
            flatFee: 0,
            nonce: nonce,
            expiry: block.timestamp + 1 days
        });
    }

    function _sign(Handshake.TradeOrder memory order) internal view returns (bytes memory) {
        bytes32 digest = hs.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Fund the maker's escrow with exactly the cost of a maker ETH leg.
    ///      No-op when the order has no maker ETH leg (deposit() rejects zero).
    function _fundMaker(uint256 makerEth) internal {
        if (makerEth == 0) return;
        uint256 makerCost = makerEth + (makerEth * 100) / 10_000; // + 1% maker-leg fee
        vm.deal(maker, makerCost);
        vm.prank(maker);
        hs.deposit{value: makerCost}();
    }

    /// @dev Solvency invariant across every account that can hold native ETH here.
    function _assertSolvent() internal view {
        uint256 tracked = hs.escrowBalance(maker) + hs.escrowBalance(taker)
            + hs.escrowBalance(feeRecipient) + hs.pendingFees(feeRecipient);
        assertEq(address(hs).balance, tracked, "solvency: balance != Sigma escrow + Sigma fees");
    }

    // ---------------------------------------------------------------------
    // 1. Happy path
    // ---------------------------------------------------------------------

    function test_HappyPath_SettlesAndStaysSolvent() public {
        _allowNow(address(colA));
        _allowNow(address(colB));

        uint256 makerEth = 1 ether;
        _fundMaker(makerEth);

        Handshake.TradeOrder memory order = _order(makerEth, 1);
        bytes memory sig = _sign(order);
        bytes32 orderHash = hs.hashOrder(order);
        uint256 expectedFee = (makerEth * 100) / 10_000; // maker-leg fee only

        vm.expectEmit(true, true, true, true, address(hs));
        emit TradeExecuted(orderHash, maker, taker, makerEth, 0, expectedFee);

        vm.prank(taker);
        hs.fulfillTrade(order, sig);

        // NFTs actually moved.
        assertEq(colA.ownerOf(TOKEN_A), taker, "maker NFT should be taker's");
        assertEq(colB.ownerOf(TOKEN_B), maker, "taker NFT should be maker's");
        // Fee accrued; maker ETH forwarded to taker (an EOA that can receive).
        assertEq(hs.pendingFees(feeRecipient), expectedFee, "fee accrual");
        assertEq(hs.escrowBalance(maker), 0, "maker escrow drained");
        assertEq(taker.balance, makerEth, "taker received maker ETH leg");
        _assertSolvent();
    }

    // ---------------------------------------------------------------------
    // 2. Not allowlisted
    // ---------------------------------------------------------------------

    function test_NotAllowlisted_Reverts() public {
        // Only allowlist colB; colA is never proposed.
        _allowNow(address(colB));
        _fundMaker(0);

        Handshake.TradeOrder memory order = _order(0, 2);
        bytes memory sig = _sign(order);

        vm.expectRevert(
            abi.encodeWithSelector(Handshake.CollectionNotAllowed.selector, address(colA))
        );
        vm.prank(taker);
        hs.fulfillTrade(order, sig);
    }

    // ---------------------------------------------------------------------
    // 3. Pending (timelock not elapsed)
    // ---------------------------------------------------------------------

    function test_Pending_TimelockNotElapsed_Reverts() public {
        _allowNow(address(colB));
        hs.proposeCollection(address(colA)); // pending, not yet live
        // Advance almost to the deadline but not past it.
        vm.warp(block.timestamp + hs.ADD_DELAY() - 1);
        _fundMaker(0);

        Handshake.TradeOrder memory order = _order(0, 3);
        bytes memory sig = _sign(order);

        vm.expectRevert(
            abi.encodeWithSelector(Handshake.CollectionNotAllowed.selector, address(colA))
        );
        vm.prank(taker);
        hs.fulfillTrade(order, sig);
    }

    // ---------------------------------------------------------------------
    // 4. Boundary: exactly allowedAt is tradable; allowedAt - 1 is not.
    // ---------------------------------------------------------------------

    function test_Boundary_ExactlyAllowedAt_Succeeds() public {
        _allowNow(address(colB));
        hs.proposeCollection(address(colA));
        uint256 allowedAt = hs.collectionAllowedAt(address(colA));

        // One second before: rejected.
        vm.warp(allowedAt - 1);
        _fundMaker(0);
        Handshake.TradeOrder memory order = _order(0, 4);
        bytes memory sig = _sign(order);
        vm.expectRevert(
            abi.encodeWithSelector(Handshake.CollectionNotAllowed.selector, address(colA))
        );
        vm.prank(taker);
        hs.fulfillTrade(order, sig);

        // Exactly at allowedAt: allowed (>= semantics). Same order/nonce/sig.
        vm.warp(allowedAt);
        vm.prank(taker);
        hs.fulfillTrade(order, sig);
        assertEq(colA.ownerOf(TOKEN_A), taker, "trade should settle exactly at allowedAt");
    }

    // ---------------------------------------------------------------------
    // 5. Removed is instant
    // ---------------------------------------------------------------------

    function test_RemovedIsInstant_RevertsSameBlock() public {
        _allowNow(address(colA));
        _allowNow(address(colB));
        _fundMaker(0);

        // Remove colA, then attempt to fill in the very same block/timestamp.
        hs.removeCollection(address(colA));
        assertEq(hs.collectionAllowedAt(address(colA)), 0, "removal zeroes the entry");

        Handshake.TradeOrder memory order = _order(0, 5);
        bytes memory sig = _sign(order);
        vm.expectRevert(
            abi.encodeWithSelector(Handshake.CollectionNotAllowed.selector, address(colA))
        );
        vm.prank(taker);
        hs.fulfillTrade(order, sig);
    }

    // ---------------------------------------------------------------------
    // 6. Lying collection is excluded up front (before ownerOf is ever trusted)
    // ---------------------------------------------------------------------

    function test_LyingCollection_NotAllowlisted_Reverts() public {
        // A hostile collection whose ownerOf lies both before and after transfer.
        // It is NOT allowlisted, so _verifyNFTs rejects it BEFORE ever calling
        // ownerOf — the allowlist, not the ownerOf checks, is the security
        // boundary. NOTE: an allowlisted collection is trusted by definition;
        // the allowlist is precisely the line between "we call into it" and "we
        // never do". This test proves a lying, unlisted collection cannot reach
        // the point where its lie would matter.
        LyingERC721 evil = new LyingERC721();
        evil.setLie(maker, taker); // would defeat both ownerOf checks if reached

        _allowNow(address(colB)); // taker side legit + allowlisted
        _fundMaker(0);

        Handshake.NFTItem[] memory makerNFTs = new Handshake.NFTItem[](1);
        makerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(evil), tokenId: 7, amount: 1});
        Handshake.NFTItem[] memory takerNFTs = new Handshake.NFTItem[](1);
        takerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colB), tokenId: TOKEN_B, amount: 1});

        Handshake.TradeOrder memory order = Handshake.TradeOrder({
            maker: maker,
            taker: address(0),
            makerNFTs: makerNFTs,
            takerNFTs: takerNFTs,
            makerEthAmount: 0,
            takerEthAmount: 0,
            feeBps: 100,
            flatFee: 0,
            nonce: 6,
            expiry: block.timestamp + 1 days
        });
        bytes memory sig = _sign(order);

        vm.expectRevert(
            abi.encodeWithSelector(Handshake.CollectionNotAllowed.selector, address(evil))
        );
        vm.prank(taker);
        hs.fulfillTrade(order, sig);
    }

    // ---------------------------------------------------------------------
    // 7. Access control
    // ---------------------------------------------------------------------

    function test_Propose_NonOwner_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, taker)
        );
        vm.prank(taker);
        hs.proposeCollection(address(colA));
    }

    function test_Remove_NonOwner_Reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, taker)
        );
        vm.prank(taker);
        hs.removeCollection(address(colA));
    }

    // ---------------------------------------------------------------------
    // 8. AlreadyAllowed guard + re-propose overwrites a pending timer
    // ---------------------------------------------------------------------

    function test_Propose_AlreadyActive_Reverts() public {
        _allowNow(address(colA)); // now live
        vm.expectRevert(
            abi.encodeWithSelector(Handshake.AlreadyAllowed.selector, address(colA))
        );
        hs.proposeCollection(address(colA));
    }

    function test_Propose_StillPending_OverwritesTimer() public {
        hs.proposeCollection(address(colA));
        uint256 firstAllowedAt = hs.collectionAllowedAt(address(colA));

        // Move forward within the pending window, then re-propose: the timer
        // resets to now + ADD_DELAY (strictly later than the first).
        vm.warp(block.timestamp + 1 hours);
        hs.proposeCollection(address(colA));
        uint256 secondAllowedAt = hs.collectionAllowedAt(address(colA));

        assertEq(secondAllowedAt, block.timestamp + hs.ADD_DELAY(), "timer reset to now+delay");
        assertGt(secondAllowedAt, firstAllowedAt, "re-propose pushes the deadline later");
    }

    function test_Propose_ZeroAddress_Reverts() public {
        vm.expectRevert(Handshake.ZeroAddress.selector);
        hs.proposeCollection(address(0));
    }

    // ---------------------------------------------------------------------
    // 9. Constructor seed: tradable in the deployment block, no delay
    // ---------------------------------------------------------------------

    function test_ConstructorSeed_ActiveImmediately_AndFills() public {
        address[] memory seed = new address[](2);
        seed[0] = address(colA);
        seed[1] = address(colB);
        Handshake seeded = new Handshake(address(this), feeRecipient, seed);

        // Seeded active immediately in the deployment block (no ADD_DELAY).
        assertEq(seeded.collectionAllowedAt(address(colA)), block.timestamp, "colA seeded now");
        assertEq(seeded.collectionAllowedAt(address(colB)), block.timestamp, "colB seeded now");

        // Re-approve the freshly deployed instance and fill immediately.
        vm.prank(maker);
        colA.setApprovalForAll(address(seeded), true);
        vm.prank(taker);
        colB.setApprovalForAll(address(seeded), true);

        Handshake.TradeOrder memory order = _order(0, 9);
        bytes32 digest = seeded.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(taker);
        seeded.fulfillTrade(order, sig);
        assertEq(colA.ownerOf(TOKEN_A), taker, "seeded collections trade in deploy block");
    }

    function test_ConstructorSeed_ZeroAddress_Reverts() public {
        address[] memory seed = new address[](1);
        seed[0] = address(0);
        vm.expectRevert(Handshake.ZeroAddress.selector);
        new Handshake(address(this), feeRecipient, seed);
    }

    // ---------------------------------------------------------------------
    // isCollectionAllowed view mirrors the enforced predicate at each phase
    // ---------------------------------------------------------------------

    function test_IsCollectionAllowed_TracksLifecycle() public {
        // Never proposed.
        assertFalse(hs.isCollectionAllowed(address(colA)), "unlisted -> false");

        // Pending: proposed but timelock not elapsed.
        hs.proposeCollection(address(colA));
        assertFalse(hs.isCollectionAllowed(address(colA)), "pending -> false");

        // Boundary: exactly allowedAt flips it true.
        vm.warp(hs.collectionAllowedAt(address(colA)));
        assertTrue(hs.isCollectionAllowed(address(colA)), "at allowedAt -> true");

        // Removed: instantly false again.
        hs.removeCollection(address(colA));
        assertFalse(hs.isCollectionAllowed(address(colA)), "removed -> false");
    }

    // ---------------------------------------------------------------------
    // 10. Events
    // ---------------------------------------------------------------------

    function test_Events_ProposeAndRemove() public {
        uint256 expectedAllowedAt = block.timestamp + hs.ADD_DELAY();
        vm.expectEmit(true, false, false, true, address(hs));
        emit CollectionProposed(address(colA), expectedAllowedAt);
        hs.proposeCollection(address(colA));

        vm.expectEmit(true, false, false, true, address(hs));
        emit CollectionRemoved(address(colA));
        hs.removeCollection(address(colA));
    }

    // ---------------------------------------------------------------------
    // 11. Multi-item side: one not-allowlisted item reverts the whole trade
    // ---------------------------------------------------------------------

    function test_MultiItem_OneNotAllowlisted_RevertsWholeTrade() public {
        // Maker side has two NFTs across two collections; only colA is listed.
        MockERC721 colC = new MockERC721("C", "C");
        uint256 tokenC = 3;
        colC.mint(maker, tokenC);
        vm.prank(maker);
        colC.setApprovalForAll(address(hs), true);

        _allowNow(address(colA));
        _allowNow(address(colB));
        // colC intentionally left off the allowlist.
        _fundMaker(0);

        Handshake.NFTItem[] memory makerNFTs = new Handshake.NFTItem[](2);
        makerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colA), tokenId: TOKEN_A, amount: 1});
        makerNFTs[1] = Handshake.NFTItem({standard: 0, contractAddress: address(colC), tokenId: tokenC, amount: 1});
        Handshake.NFTItem[] memory takerNFTs = new Handshake.NFTItem[](1);
        takerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colB), tokenId: TOKEN_B, amount: 1});

        Handshake.TradeOrder memory order = Handshake.TradeOrder({
            maker: maker,
            taker: address(0),
            makerNFTs: makerNFTs,
            takerNFTs: takerNFTs,
            makerEthAmount: 0,
            takerEthAmount: 0,
            feeBps: 100,
            flatFee: 0,
            nonce: 11,
            expiry: block.timestamp + 1 days
        });
        bytes memory sig = _sign(order);

        vm.expectRevert(
            abi.encodeWithSelector(Handshake.CollectionNotAllowed.selector, address(colC))
        );
        vm.prank(taker);
        hs.fulfillTrade(order, sig);

        // Atomicity: nothing moved, nonce unused, no fees accrued.
        assertEq(colA.ownerOf(TOKEN_A), maker, "colA NFT stays with maker");
        assertEq(colB.ownerOf(TOKEN_B), taker, "colB NFT stays with taker");
        assertEq(hs.pendingFees(feeRecipient), 0, "no fees on reverted trade");
    }
}
