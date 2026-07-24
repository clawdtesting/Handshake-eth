// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Handshake} from "../src/Handshake.sol";
import {MockERC721} from "./mocks/MockERC721.sol";
import {RejectingReceiver} from "./mocks/RejectingReceiver.sol";

/// @notice Fuzzed handler that settles every priced fill against a ETH-rejecting
///         contract taker, so the maker's ETH leg can never be delivered
///         directly and ALWAYS falls back to the _payout escrow-credit branch
///         (escrowBalance[to] += amount) — the single state write that happens
///         after external interactions. The existing solvency invariant only
///         uses EOAs, so it never drives this post-interaction write across
///         random sequences; this handler does, on every successful fill.
contract FallbackSolvencyHandler is Test {
    Handshake public hs;
    MockERC721 public colA;
    MockERC721 public colB;
    RejectingReceiver public taker;

    uint256 internal constant MAKER_PK = 0xA11CE;
    address public maker;
    address public feeRecipient;

    uint256 internal constant POOL = 20;
    uint256 internal nonceCounter;

    constructor(Handshake hs_, address feeRecipient_) {
        hs = hs_;
        feeRecipient = feeRecipient_;
        maker = vm.addr(MAKER_PK);

        colA = new MockERC721("A", "A");
        colB = new MockERC721("B", "B");
        taker = new RejectingReceiver(hs_);
        for (uint256 i = 0; i < POOL; i++) {
            colA.mint(maker, i);
            colB.mint(address(taker), i);
        }
        vm.prank(maker);
        colA.setApprovalForAll(address(hs), true);
        taker.approveCollection(address(colB));
    }

    /// @dev A priced NFT<->NFT fill (maker ETH leg always > 0) settled by the
    ///      rejecting taker, so the maker-leg payout always hits the escrow-credit
    ///      fallback. Wrapped in try/catch: once a token pair is consumed the fill
    ///      reverts (maker no longer owns it) and is skipped — the invariant must
    ///      still hold on the rolled-back state.
    function fill(uint256 tokenSeed, uint256 makerEthSeed) external {
        uint256 tokenId = bound(tokenSeed, 0, POOL - 1);
        uint256 makerEth = bound(makerEthSeed, 0.001 ether, 5 ether); // always priced

        // Top up the maker's escrow to fund the leg + its 1% fee.
        uint256 makerCost = makerEth + (makerEth * 100) / 10_000;
        uint256 have = hs.escrowBalance(maker);
        if (have < makerCost) {
            uint256 need = makerCost - have;
            vm.deal(maker, need);
            vm.prank(maker);
            hs.deposit{value: need}();
        }

        uint256 nonce = ++nonceCounter;

        Handshake.NFTItem[] memory makerNFTs = new Handshake.NFTItem[](1);
        makerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colA), tokenId: tokenId, amount: 1});
        Handshake.NFTItem[] memory takerNFTs = new Handshake.NFTItem[](1);
        takerNFTs[0] = Handshake.NFTItem({standard: 0, contractAddress: address(colB), tokenId: tokenId, amount: 1});

        Handshake.TradeOrder memory order = Handshake.TradeOrder({
            maker: maker,
            taker: address(taker),
            makerNFTs: makerNFTs,
            takerNFTs: takerNFTs,
            makerEthAmount: makerEth,
            takerEthAmount: 0,
            feeBps: 100,
            flatFee: 0,
            nonce: nonce,
            expiry: block.timestamp + 365 days
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(MAKER_PK, hs.hashOrder(order));
        bytes memory sig = abi.encodePacked(r, s, v);

        // No taker ETH leg -> msg.value 0. The rejecting taker fills.
        try taker.fulfill(order, sig) {} catch {}
    }
}

/// @notice Solvency must hold even when every settlement drives the post-
///         interaction escrow-credit write. balance == Σescrow + ΣpendingFees on
///         every reachable state, across arbitrary fill sequences that all fall
///         back through _payout.
contract HandshakeFallbackSolvencyTest is StdInvariant, Test {
    Handshake internal hs;
    FallbackSolvencyHandler internal handler;
    address internal feeRecipient = address(0xFEE);

    function setUp() public {
        vm.warp(1_000_000);
        address[] memory noSeed;
        hs = new Handshake(address(this), feeRecipient, noSeed);
        handler = new FallbackSolvencyHandler(hs, feeRecipient);

        // Allowlist the handler's collections up front (test is owner), then warp
        // past the timelock so every fuzzed fill can settle deterministically.
        hs.proposeCollection(address(handler.colA()));
        hs.proposeCollection(address(handler.colB()));
        vm.warp(block.timestamp + hs.ADD_DELAY());

        // Drive only fill(); everything else is constructor setup.
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = FallbackSolvencyHandler.fill.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_FallbackSolvency() public view {
        uint256 tracked = hs.escrowBalance(handler.maker())
            + hs.escrowBalance(address(handler.taker())) + hs.escrowBalance(feeRecipient)
            + hs.pendingFees(feeRecipient);
        assertEq(address(hs).balance, tracked, "balance must equal Sigma escrow + Sigma fees");
    }
}
