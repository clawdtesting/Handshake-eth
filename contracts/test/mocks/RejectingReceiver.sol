// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Handshake} from "../../src/Handshake.sol";

/// @title RejectingReceiver
/// @notice A contract taker that accepts NFTs but REVERTS on any plain native
///         transfer (no receive/fallback). As a ETH payout recipient it forces
///         the stipended send to fail, driving Handshake's _payout fallback-
///         credit branch (escrowBalance[to] += amount) — the one state write
///         after external interactions — on EVERY priced fill. The fuzzed
///         invariant in HandshakeFallbackSolvency.t.sol uses it so random
///         settlement sequences always exercise that post-interaction write.
contract RejectingReceiver is IERC721Receiver {
    Handshake public immutable hs;

    constructor(Handshake hs_) {
        hs = hs_;
    }

    function approveCollection(address collection) external {
        IERC721(collection).setApprovalForAll(address(hs), true);
    }

    function fulfill(Handshake.TradeOrder calldata order, bytes calldata signature)
        external
        payable
    {
        hs.fulfillTrade{value: msg.value}(order, signature);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    // No receive()/fallback(): every native send to this contract reverts, so
    // the settlement payout always falls back to an escrow credit.
}
