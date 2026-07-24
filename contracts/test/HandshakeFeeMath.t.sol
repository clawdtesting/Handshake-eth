// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Handshake} from "../src/Handshake.sol";
import {MockERC721} from "./mocks/MockERC721.sol";

/// @notice Fuzzes the fee arithmetic across the full range of amounts and fee
///         parameters to prove the accrual is exact and solvency holds for any
///         input — including at the MAX_FEE_BPS / MAX_FLAT_SWAP_FEE caps and the
///         integer-division rounding boundary. Complements the fixed dual-leg
///         case in HandshakeAdversarial.t.sol.
contract HandshakeFeeMath is Test {
    Handshake internal hs;

    uint256 internal constant MAKER_PK = 0xA11CE;
    uint256 internal constant TAKER_PK = 0xB0B;
    address internal maker;
    address internal takerEOA;
    address internal feeRecipient = address(0xFEE);

    MockERC721 internal colA;
    MockERC721 internal colB;
    uint256 internal constant TOKEN_A = 1;
    uint256 internal constant TOKEN_B = 2;

    uint256 internal constant BPS_DENOMINATOR = 10_000;

    function setUp() public {
        vm.warp(1_000_000);
        maker = vm.addr(MAKER_PK);
        takerEOA = vm.addr(TAKER_PK);

        colA = new MockERC721("A", "A");
        colB = new MockERC721("B", "B");
        address[] memory seed = new address[](2);
        seed[0] = address(colA);
        seed[1] = address(colB);
        hs = new Handshake(address(this), feeRecipient, seed);

        colA.mint(maker, TOKEN_A);
        colB.mint(takerEOA, TOKEN_B);
        vm.prank(maker);
        colA.setApprovalForAll(address(hs), true);
        vm.prank(takerEOA);
        colB.setApprovalForAll(address(hs), true);
    }

    function _order(uint256 makerEth, uint256 takerEth, uint256 feeBps, uint256 flatFee)
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
            taker: takerEOA,
            makerNFTs: makerNFTs,
            takerNFTs: takerNFTs,
            makerEthAmount: makerEth,
            takerEthAmount: takerEth,
            feeBps: feeBps,
            flatFee: flatFee,
            nonce: 1,
            expiry: block.timestamp + 1 days
        });
    }

    function _sign(Handshake.TradeOrder memory order) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, hs.hashOrder(order));
        return abi.encodePacked(r, s, v);
    }

    function _assertSolvent() internal view {
        uint256 tracked = hs.escrowBalance(maker) + hs.escrowBalance(takerEOA)
            + hs.escrowBalance(feeRecipient) + hs.pendingFees(feeRecipient);
        assertEq(address(hs).balance, tracked, "solvency: balance != Sigma escrow + Sigma fees");
    }

    /// @dev Per-ETH-leg fee (order has a maker ETH leg, so no flat fee applies).
    function testFuzz_FeeMath_BpsLegs(uint256 makerEth, uint256 takerEth, uint256 feeBps) public {
        feeBps = bound(feeBps, 0, hs.MAX_FEE_BPS());
        makerEth = bound(makerEth, 1, 1e24); // > 0 so the flat-fee branch is off
        takerEth = bound(takerEth, 0, 1e24);

        uint256 makerLegFee = (makerEth * feeBps) / BPS_DENOMINATOR;
        uint256 takerLegFee = (takerEth * feeBps) / BPS_DENOMINATOR;
        uint256 expectedFee = makerLegFee + takerLegFee;

        // Maker funds its leg + maker-side fee from escrow.
        uint256 makerCost = makerEth + makerLegFee;
        vm.deal(maker, makerCost);
        vm.prank(maker);
        hs.deposit{value: makerCost}();

        // Taker funds its leg + taker-side fee as msg.value.
        uint256 msgValue = takerEth + takerLegFee;
        vm.deal(takerEOA, msgValue);

        Handshake.TradeOrder memory order = _order(makerEth, takerEth, feeBps, 0);
        bytes memory sig = _sign(order);

        vm.prank(takerEOA);
        hs.fulfillTrade{value: msgValue}(order, sig);

        assertEq(hs.pendingFees(feeRecipient), expectedFee, "fee accrual exact for any bps");
        assertEq(maker.balance, takerEth, "maker received taker ETH leg");
        assertEq(takerEOA.balance, makerEth, "taker received maker ETH leg");
        assertEq(hs.escrowBalance(maker), 0, "maker escrow fully consumed");
        _assertSolvent();
    }

    /// @dev Flat swap fee applies only when NO ETH moves on either side.
    function testFuzz_FeeMath_FlatFee(uint256 flatFee) public {
        flatFee = bound(flatFee, 0, hs.MAX_FLAT_SWAP_FEE());

        // Taker funds exactly the flat fee (no ETH legs).
        vm.deal(takerEOA, flatFee);

        Handshake.TradeOrder memory order = _order(0, 0, 100, flatFee);
        bytes memory sig = _sign(order);

        vm.prank(takerEOA);
        hs.fulfillTrade{value: flatFee}(order, sig);

        assertEq(hs.pendingFees(feeRecipient), flatFee, "flat fee accrual exact");
        assertEq(colA.ownerOf(TOKEN_A), takerEOA, "NFT swapped");
        assertEq(colB.ownerOf(TOKEN_B), maker, "NFT swapped");
        _assertSolvent();
    }
}
