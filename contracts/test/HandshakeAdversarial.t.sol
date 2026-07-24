// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Handshake} from "../src/Handshake.sol";
import {MockERC721} from "./mocks/MockERC721.sol";
import {ReentrantTaker} from "./mocks/ReentrantTaker.sol";
import {GasGriefingReceiver} from "./mocks/GasGriefingReceiver.sol";
import {ReturnBomber} from "./mocks/ReturnBomber.sol";
import {ReentrantMaker} from "./mocks/ReentrantMaker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Adversarial coverage for the two spots the existing suite never
///         exercises, both on the most delicate part of the contract:
///
///         1. Reentrancy at the mid-settlement ERC-721 receive hook. In
///            fulfillTrade the maker's NFTs are safeTransferFrom'd to the taker
///            AFTER nonceUsed / escrow effects are committed but BEFORE the
///            second leg and the ETH payouts. A contract taker's
///            onERC721Received fires exactly there; these tests prove the
///            ReentrancyGuard holds at that window, with a control case showing
///            it is the RE-ENTRY (not merely being a contract) that reverts.
///
///         2. The _payout fallback-credit branch (escrowBalance[to] += amount) —
///            the one state write that happens AFTER external interactions, the
///            CEI exception the audit comment defends in prose. A gas-griefing
///            recipient and a return-bomber both drive that branch: the payout
///            falls back to a recoverable escrow credit, settlement never
///            reverts, and solvency holds.
///
///         Plus exact dual-ETH-leg fee accounting to the wei, with off-by-one
///         payments rejected.
contract HandshakeAdversarial is Test {
    Handshake internal hs;

    uint256 internal constant MAKER_PK = 0xA11CE;
    uint256 internal constant TAKER_PK = 0xB0B;
    address internal maker;
    address internal feeRecipient = address(0xFEE);

    MockERC721 internal colA; // maker side
    MockERC721 internal colB; // taker side

    uint256 internal constant TOKEN_A = 1;

    // Mirror of Handshake's event so vm.expectEmit can match it.
    event ProceedsCredited(address indexed to, uint256 amount);

    function setUp() public {
        vm.warp(1_000_000);
        maker = vm.addr(MAKER_PK);

        colA = new MockERC721("A", "A");
        colB = new MockERC721("B", "B");

        // Seed both collections onto the allowlist at genesis (active in the
        // deploy block), so these tests focus on settlement mechanics rather
        // than re-testing the timelock (covered in HandshakeAllowlist.t.sol).
        address[] memory seed = new address[](2);
        seed[0] = address(colA);
        seed[1] = address(colB);
        hs = new Handshake(address(this), feeRecipient, seed);

        colA.mint(maker, TOKEN_A);
        vm.prank(maker);
        colA.setApprovalForAll(address(hs), true);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /// @dev A single colA(TOKEN_A) <-> colB(colBToken) order with optional ETH
    ///      legs on each side, feeBps = 1%, addressed to `takerAddr`.
    function _buildOrder(
        address takerAddr,
        uint256 colBToken,
        uint256 makerEth,
        uint256 takerEth,
        uint256 nonce
    ) internal view returns (Handshake.TradeOrder memory order) {
        Handshake.NFTItem[] memory makerNFTs = new Handshake.NFTItem[](1);
        makerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colA), tokenId: TOKEN_A, amount: 1});
        Handshake.NFTItem[] memory takerNFTs = new Handshake.NFTItem[](1);
        takerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colB), tokenId: colBToken, amount: 1});

        order = Handshake.TradeOrder({
            maker: maker,
            taker: takerAddr,
            makerNFTs: makerNFTs,
            takerNFTs: takerNFTs,
            makerEthAmount: makerEth,
            takerEthAmount: takerEth,
            feeBps: 100, // 1%
            flatFee: 0,
            nonce: nonce,
            expiry: block.timestamp + 1 days
        });
    }

    function _sign(Handshake.TradeOrder memory order) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, hs.hashOrder(order));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Fund the maker's escrow with a maker ETH leg + its 1% fee.
    function _fundMaker(uint256 makerEth) internal {
        if (makerEth == 0) return;
        uint256 makerCost = makerEth + (makerEth * 100) / 10_000;
        vm.deal(maker, makerCost);
        vm.prank(maker);
        hs.deposit{value: makerCost}();
    }

    /// @dev balance == Σescrow + ΣpendingFees across every account that can hold
    ///      native ETH in these scenarios.
    function _assertSolvent(address other) internal view {
        uint256 tracked = hs.escrowBalance(maker) + hs.escrowBalance(feeRecipient)
            + hs.escrowBalance(other) + hs.pendingFees(feeRecipient);
        assertEq(address(hs).balance, tracked, "solvency: balance != Sigma escrow + Sigma fees");
    }

    // ---------------------------------------------------------------------
    // 1. Reentrancy at the mid-settlement NFT receive hook
    // ---------------------------------------------------------------------

    function test_Reentrancy_WithdrawFromReceiveHook_UnwindsWholeTrade() public {
        ReentrantTaker attacker = new ReentrantTaker(hs);
        uint256 tokenB = 100;
        colB.mint(address(attacker), tokenB);
        attacker.approveCollection(address(colB));

        // Attacker funds its own escrow, so a re-entrant withdraw would have a
        // real balance to pull absent the guard — the guard is the only defense
        // this test exercises.
        vm.deal(address(attacker), 1 ether);
        attacker.depositEscrow{value: 1 ether}();
        attacker.setMode(ReentrantTaker.Mode.Withdraw);

        Handshake.TradeOrder memory order = _buildOrder(address(attacker), tokenB, 0, 0, 1);
        bytes memory sig = _sign(order);

        // The re-entrant withdraw() trips the guard; ERC721 bubbles the raw
        // reason, so the whole safeTransferFrom — and thus fulfillTrade — reverts.
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.fulfill(order, sig);

        // Nothing moved: NFTs unmoved, nonce unused, escrow intact.
        assertEq(colA.ownerOf(TOKEN_A), maker, "maker NFT unmoved");
        assertEq(colB.ownerOf(tokenB), address(attacker), "taker NFT unmoved");
        assertFalse(hs.nonceUsed(maker, 1), "nonce not consumed");
        assertEq(hs.escrowBalance(address(attacker)), 1 ether, "attacker escrow untouched");
        _assertSolvent(address(attacker));
    }

    function test_Reentrancy_WithdrawFeesFromReceiveHook_UnwindsWholeTrade() public {
        ReentrantTaker attacker = new ReentrantTaker(hs);
        uint256 tokenB = 101;
        colB.mint(address(attacker), tokenB);
        attacker.approveCollection(address(colB));
        attacker.setMode(ReentrantTaker.Mode.WithdrawFees);

        Handshake.TradeOrder memory order = _buildOrder(address(attacker), tokenB, 0, 0, 2);
        bytes memory sig = _sign(order);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        attacker.fulfill(order, sig);

        assertEq(colA.ownerOf(TOKEN_A), maker, "maker NFT unmoved");
        assertEq(colB.ownerOf(tokenB), address(attacker), "taker NFT unmoved");
        assertFalse(hs.nonceUsed(maker, 2), "nonce not consumed");
        _assertSolvent(address(attacker));
    }

    /// @notice Control: an otherwise-identical contract taker that does NOT
    ///         re-enter settles cleanly. Proves the reverts above are caused by
    ///         the re-entry, not by the taker being a contract.
    function test_Control_BenignContractTaker_Settles() public {
        ReentrantTaker taker = new ReentrantTaker(hs); // Mode.None
        uint256 tokenB = 102;
        colB.mint(address(taker), tokenB);
        taker.approveCollection(address(colB));

        Handshake.TradeOrder memory order = _buildOrder(address(taker), tokenB, 0, 0, 3);
        bytes memory sig = _sign(order);

        taker.fulfill(order, sig);

        assertEq(colA.ownerOf(TOKEN_A), address(taker), "maker NFT delivered to taker");
        assertEq(colB.ownerOf(tokenB), maker, "taker NFT delivered to maker");
        assertTrue(hs.nonceUsed(maker, 3), "nonce consumed on success");
    }

    // ---------------------------------------------------------------------
    // 1b. Reentrancy at the SECOND leg: a contract MAKER (EIP-1271) re-enters
    //     from onERC721Received when the taker's NFT is delivered to it. Proves
    //     the guard holds on the maker side too, not just the taker's first leg.
    // ---------------------------------------------------------------------

    function test_Reentrancy_MakerSide_Withdraw_UnwindsWholeTrade() public {
        (ReentrantMaker attackerMaker, address takerEOA, Handshake.TradeOrder memory order) =
            _setUpMakerSideAttack(400, 401, 10);
        vm.deal(address(attackerMaker), 1 ether);
        attackerMaker.depositEscrow{value: 1 ether}();
        attackerMaker.setMode(ReentrantMaker.Mode.Withdraw);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(takerEOA);
        hs.fulfillTrade(order, ""); // EIP-1271 maker accepts any signature

        assertEq(colA.ownerOf(400), address(attackerMaker), "maker NFT unmoved");
        assertEq(colB.ownerOf(401), takerEOA, "taker NFT unmoved");
        assertFalse(hs.nonceUsed(address(attackerMaker), 10), "nonce not consumed");
        assertEq(hs.escrowBalance(address(attackerMaker)), 1 ether, "maker escrow untouched");
    }

    function test_Reentrancy_MakerSide_WithdrawFees_UnwindsWholeTrade() public {
        (ReentrantMaker attackerMaker, address takerEOA, Handshake.TradeOrder memory order) =
            _setUpMakerSideAttack(402, 403, 11);
        attackerMaker.setMode(ReentrantMaker.Mode.WithdrawFees);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(takerEOA);
        hs.fulfillTrade(order, "");

        assertEq(colA.ownerOf(402), address(attackerMaker), "maker NFT unmoved");
        assertEq(colB.ownerOf(403), takerEOA, "taker NFT unmoved");
        assertFalse(hs.nonceUsed(address(attackerMaker), 11), "nonce not consumed");
    }

    /// @dev Wire up a contract-maker (colA #makerTok) vs EOA-taker (colB #takerTok)
    ///      NFT<->NFT order. The EOA taker takes the first leg without a callback,
    ///      so settlement reaches the second leg where the maker's hook fires.
    function _setUpMakerSideAttack(uint256 makerTok, uint256 takerTok, uint256 nonce)
        internal
        returns (ReentrantMaker attackerMaker, address takerEOA, Handshake.TradeOrder memory order)
    {
        attackerMaker = new ReentrantMaker(hs);
        colA.mint(address(attackerMaker), makerTok);
        attackerMaker.approveCollection(address(colA));

        takerEOA = vm.addr(TAKER_PK);
        colB.mint(takerEOA, takerTok);
        vm.prank(takerEOA);
        colB.setApprovalForAll(address(hs), true);

        Handshake.NFTItem[] memory makerNFTs = new Handshake.NFTItem[](1);
        makerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colA), tokenId: makerTok, amount: 1});
        Handshake.NFTItem[] memory takerNFTs = new Handshake.NFTItem[](1);
        takerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colB), tokenId: takerTok, amount: 1});
        order = Handshake.TradeOrder({
            maker: address(attackerMaker),
            taker: takerEOA,
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

    // ---------------------------------------------------------------------
    // 2. _payout fallback-credit branch (post-interaction state write)
    // ---------------------------------------------------------------------

    function test_Payout_GasGriefer_FallsBackToEscrow_AndRecovers() public {
        GasGriefingReceiver taker = new GasGriefingReceiver(hs);
        uint256 tokenB = 200;
        colB.mint(address(taker), tokenB);
        taker.approveCollection(address(colB));

        // Maker ETH leg is auto-withdrawn to the taker; the taker's receive burns
        // more than the 30k stipend, so the direct send fails.
        uint256 makerEth = 1 ether;
        _fundMaker(makerEth);

        Handshake.TradeOrder memory order = _buildOrder(address(taker), tokenB, makerEth, 0, 4);
        bytes memory sig = _sign(order);

        vm.expectEmit(true, false, false, true, address(hs));
        emit ProceedsCredited(address(taker), makerEth);
        taker.fulfill(order, sig); // no taker ETH leg -> 0 msg.value

        // Settlement completed despite the hostile recipient...
        assertEq(colA.ownerOf(TOKEN_A), address(taker), "NFT delivered");
        assertEq(colB.ownerOf(tokenB), maker, "NFT delivered");
        // ...the un-deliverable payout was credited to escrow, not reverted.
        assertEq(hs.escrowBalance(address(taker)), makerEth, "payout credited to escrow");
        assertEq(hs.pendingFees(feeRecipient), (makerEth * 100) / 10_000, "maker-leg fee accrued");
        _assertSolvent(address(taker));

        // Recoverable: withdraw() forwards full gas, so the griefer can pull it.
        taker.pull(makerEth);
        assertEq(address(taker).balance, makerEth, "griefer recovered credited ETH");
        assertEq(hs.escrowBalance(address(taker)), 0, "escrow drained on recovery");
        _assertSolvent(address(taker));
    }

    function test_Payout_ReturnBomber_FallsBackToEscrow_AndRecovers() public {
        ReturnBomber taker = new ReturnBomber(hs);
        uint256 tokenB = 201;
        colB.mint(address(taker), tokenB);
        taker.approveCollection(address(colB));

        uint256 makerEth = 1 ether;
        _fundMaker(makerEth);

        Handshake.TradeOrder memory order = _buildOrder(address(taker), tokenB, makerEth, 0, 5);
        bytes memory sig = _sign(order);

        vm.expectEmit(true, false, false, true, address(hs));
        emit ProceedsCredited(address(taker), makerEth);
        taker.fulfill(order, sig);

        // The return-bomb neither reverted settlement nor inflated the caller
        // (zero-length output buffer); it simply fell back to an escrow credit.
        assertEq(colA.ownerOf(TOKEN_A), address(taker), "NFT delivered");
        assertEq(colB.ownerOf(tokenB), maker, "NFT delivered");
        assertEq(hs.escrowBalance(address(taker)), makerEth, "payout credited to escrow");
        _assertSolvent(address(taker));

        // Recoverable via full-gas withdraw (blob discarded again).
        taker.pull(makerEth);
        assertEq(address(taker).balance, makerEth, "bomber recovered credited ETH");
        _assertSolvent(address(taker));
    }

    // ---------------------------------------------------------------------
    // 3. Dual-ETH-leg fee exactness + off-by-one payment rejection
    // ---------------------------------------------------------------------

    function test_DualMonLeg_FeesExactToTheWei() public {
        address takerEOA = vm.addr(TAKER_PK);
        uint256 tokenB = 300;
        colB.mint(takerEOA, tokenB);
        vm.prank(takerEOA);
        colB.setApprovalForAll(address(hs), true);

        uint256 makerEth = 3 ether;
        uint256 takerEth = 1 ether;
        uint256 makerLegFee = (makerEth * 100) / 10_000; // 0.03
        uint256 takerLegFee = (takerEth * 100) / 10_000; // 0.01
        uint256 totalFee = makerLegFee + takerLegFee;

        // Maker funds its leg + maker-side fee from escrow.
        uint256 makerCost = makerEth + makerLegFee;
        vm.deal(maker, makerCost);
        vm.prank(maker);
        hs.deposit{value: makerCost}();

        Handshake.TradeOrder memory order = _buildOrder(takerEOA, tokenB, makerEth, takerEth, 6);
        bytes memory sig = _sign(order);

        uint256 msgValue = takerEth + takerLegFee;
        vm.deal(takerEOA, msgValue);
        vm.prank(takerEOA);
        hs.fulfillTrade{value: msgValue}(order, sig);

        // Fee accrual is exact to the wei; both ETH legs delivered to EOAs.
        assertEq(hs.pendingFees(feeRecipient), totalFee, "total fee exact to the wei");
        assertEq(maker.balance, takerEth, "maker received taker ETH leg");
        assertEq(takerEOA.balance, makerEth, "taker received maker ETH leg");
        assertEq(colA.ownerOf(TOKEN_A), takerEOA, "NFT swapped");
        assertEq(colB.ownerOf(tokenB), maker, "NFT swapped");
        _assertSolvent(takerEOA);
    }

    function test_OffByOnePayment_Rejected() public {
        address takerEOA = vm.addr(TAKER_PK);
        uint256 tokenB = 301;
        colB.mint(takerEOA, tokenB);
        vm.prank(takerEOA);
        colB.setApprovalForAll(address(hs), true);

        uint256 makerEth = 3 ether;
        uint256 takerEth = 1 ether;
        uint256 takerLegFee = (takerEth * 100) / 10_000;
        uint256 correct = takerEth + takerLegFee;

        // Fund the maker so the ONLY thing wrong is the taker's msg.value.
        _fundMaker(makerEth);

        Handshake.TradeOrder memory order = _buildOrder(takerEOA, tokenB, makerEth, takerEth, 7);
        bytes memory sig = _sign(order);

        // One wei over: rejected.
        vm.deal(takerEOA, correct + 1);
        vm.prank(takerEOA);
        vm.expectRevert(Handshake.IncorrectPayment.selector);
        hs.fulfillTrade{value: correct + 1}(order, sig);

        // One wei under: rejected. (Payment check precedes the nonce effect, so
        // the order is still fillable — proving it was the amount, not reuse.)
        vm.deal(takerEOA, correct - 1);
        vm.prank(takerEOA);
        vm.expectRevert(Handshake.IncorrectPayment.selector);
        hs.fulfillTrade{value: correct - 1}(order, sig);

        assertFalse(hs.nonceUsed(maker, 7), "nonce untouched after rejected fills");
    }
}
