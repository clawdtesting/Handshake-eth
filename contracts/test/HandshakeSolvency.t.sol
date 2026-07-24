// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Handshake} from "../src/Handshake.sol";
import {MockERC721} from "./mocks/MockERC721.sol";

/// @notice Fuzzed handler that interleaves the new allowlist mutations
///         (propose / remove / time warps) with escrow deposits and real
///         settlements, so the invariant below can prove the allowlist did not
///         perturb native-ETH accounting.
contract SolvencyHandler is Test {
    Handshake public hs;
    MockERC721 public colA;
    MockERC721 public colB;

    uint256 internal constant MAKER_PK = 0xA11CE;
    uint256 internal constant TAKER_PK = 0xB0B;
    address public maker;
    address public taker;
    address public feeRecipient;

    uint256 internal constant POOL = 20; // tokens minted per side

    constructor(Handshake hs_, address feeRecipient_) {
        hs = hs_;
        feeRecipient = feeRecipient_;
        maker = vm.addr(MAKER_PK);
        taker = vm.addr(TAKER_PK);

        colA = new MockERC721("A", "A");
        colB = new MockERC721("B", "B");
        for (uint256 i = 0; i < POOL; i++) {
            colA.mint(maker, i);
            colB.mint(taker, i);
        }
        vm.prank(maker);
        colA.setApprovalForAll(address(hs), true);
        vm.prank(taker);
        colB.setApprovalForAll(address(hs), true);
    }

    // ----- allowlist mutations (owner is this handler; hs deployed with it) ---

    function proposeA() external {
        try hs.proposeCollection(address(colA)) {} catch {}
    }

    function proposeB() external {
        try hs.proposeCollection(address(colB)) {} catch {}
    }

    function removeA() external {
        hs.removeCollection(address(colA));
    }

    function removeB() external {
        hs.removeCollection(address(colB));
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 0, 4 days);
        vm.warp(block.timestamp + dt);
    }

    // ----- escrow + settlement ------------------------------------------------

    function depositMaker(uint256 amt) external {
        amt = bound(amt, 0, 100 ether);
        if (amt == 0) return;
        vm.deal(maker, amt);
        vm.prank(maker);
        hs.deposit{value: amt}();
    }

    /// @dev Attempt a settlement of colA(tokenId) for colB(tokenId) with an
    ///      optional maker ETH leg. Wrapped so an expected revert (not
    ///      allowlisted, pending, nonce reuse, insufficient escrow) simply does
    ///      nothing — the invariant must still hold after the rolled-back call.
    function fill(uint256 tokenSeed, uint256 makerEth, uint256 nonce) external {
        uint256 tokenId = bound(tokenSeed, 0, POOL - 1);
        makerEth = bound(makerEth, 0, 10 ether);
        uint256 makerCost = makerEth + (makerEth * 100) / 10_000;
        if (hs.escrowBalance(maker) < makerCost) makerEth = 0;

        Handshake.NFTItem[] memory makerNFTs = new Handshake.NFTItem[](1);
        makerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colA), tokenId: tokenId, amount: 1});
        Handshake.NFTItem[] memory takerNFTs = new Handshake.NFTItem[](1);
        takerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colB), tokenId: tokenId, amount: 1});

        Handshake.TradeOrder memory order = Handshake.TradeOrder({
            maker: maker,
            taker: address(0),
            makerNFTs: makerNFTs,
            takerNFTs: takerNFTs,
            makerEthAmount: makerEth,
            takerEthAmount: 0,
            feeBps: 100,
            flatFee: 0,
            nonce: nonce,
            expiry: block.timestamp + 365 days
        });
        bytes32 digest = hs.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(taker);
        try hs.fulfillTrade(order, sig) {} catch {}
    }
}

/// @notice Solvency invariant: on every reachable state, the contract's native
///         balance must equal the sum of every escrow balance plus every
///         pending fee. The allowlist adds no native flow, so this must remain
///         exactly true across arbitrary propose/remove/warp/deposit/fill
///         sequences.
contract HandshakeSolvencyTest is Test {
    Handshake internal hs;
    SolvencyHandler internal handler;
    address internal feeRecipient = address(0xFEE);

    function setUp() public {
        vm.warp(1_000_000);
        address[] memory noSeed;
        // The handler is the owner so its proposeCollection/removeCollection
        // calls are authorized; it deploys the token pools it settles against.
        hs = new Handshake(address(this), feeRecipient, noSeed);
        handler = new SolvencyHandler(hs, feeRecipient);
        hs.transferOwnership(address(handler));
        vm.prank(address(handler));
        hs.acceptOwnership();

        targetContract(address(handler));
    }

    function invariant_Solvency() public view {
        uint256 tracked = hs.escrowBalance(handler.maker())
            + hs.escrowBalance(handler.taker()) + hs.escrowBalance(feeRecipient)
            + hs.pendingFees(feeRecipient);
        assertEq(address(hs).balance, tracked, "balance must equal Sigma escrow + Sigma fees");
    }
}
