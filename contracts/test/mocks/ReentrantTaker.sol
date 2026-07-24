// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Handshake} from "../../src/Handshake.sol";

/// @title ReentrantTaker
/// @notice A contract taker that attempts to re-enter Handshake from inside the
///         ERC-721 receive hook. When the maker's NFT is `safeTransferFrom`'d to
///         this taker mid-settlement, `onERC721Received` fires AFTER the nonce/
///         escrow effects are committed but BEFORE the second NFT leg and the ETH
///         payouts. That is the single most delicate window in `fulfillTrade`.
///         This mock re-enters `withdraw`/`withdrawFees` there so a test can prove
///         the ReentrancyGuard holds at exactly that point: the re-entrant call
///         must revert and unwind the whole trade.
///
///         Mode.None makes it a benign contract taker (accepts the NFT, does not
///         re-enter) so a control test can show it is the RE-ENTRY, not merely
///         being a contract, that reverts.
contract ReentrantTaker is IERC721Receiver {
    enum Mode {
        None,
        Withdraw,
        WithdrawFees
    }

    Handshake public immutable hs;
    Mode public mode;

    constructor(Handshake hs_) {
        hs = hs_;
    }

    function setMode(Mode m) external {
        mode = m;
    }

    /// @dev Fund this contract's own escrow so a re-entrant withdraw would have a
    ///      real balance to steal absent the guard (makes the guard the only line
    ///      of defense the test is exercising).
    function depositEscrow() external payable {
        hs.deposit{value: msg.value}();
    }

    function approveCollection(address collection) external {
        IERC721(collection).setApprovalForAll(address(hs), true);
    }

    function fulfill(Handshake.TradeOrder calldata order, bytes calldata signature) external {
        hs.fulfillTrade(order, signature);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        if (mode == Mode.Withdraw) {
            // Re-enter the guarded contract mid-settlement. Must revert.
            hs.withdraw(1);
        } else if (mode == Mode.WithdrawFees) {
            hs.withdrawFees();
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
