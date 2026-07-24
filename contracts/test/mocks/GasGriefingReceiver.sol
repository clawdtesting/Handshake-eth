// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Handshake} from "../../src/Handshake.sol";

/// @title GasGriefingReceiver
/// @notice A contract taker whose native-receive hook deliberately burns far
///         more than PAYOUT_GAS_STIPEND (30k). It accepts NFTs normally (so it
///         can be a taker) but cannot be paid within the settlement stipend.
///         Used to prove the auto-withdraw payout falls back to a recoverable
///         escrow credit instead of reverting/OOG-ing the trade — a hostile
///         recipient cannot grief settlement. `withdraw()` forwards full gas, so
///         the same recipient can still pull the credited ETH afterwards.
contract GasGriefingReceiver is IERC721Receiver {
    Handshake public immutable hs;
    uint256 public sink;

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

    function pull(uint256 amount) external {
        hs.withdraw(amount);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @dev Bounded but expensive: ~1000 keccak rounds burn well over the 30k
    ///      payout stipend (so the stipended payout OOGs and falls back), yet
    ///      complete comfortably under the full gas a withdraw() forwards (so the
    ///      credited funds remain recoverable).
    receive() external payable {
        uint256 s = sink;
        for (uint256 i = 0; i < 1000; i++) {
            s = uint256(keccak256(abi.encode(s, i)));
        }
        sink = s;
    }
}
