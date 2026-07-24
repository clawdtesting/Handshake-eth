// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Handshake} from "../../src/Handshake.sol";

/// @title ReentrantMaker
/// @notice A contract MAKER (authorized via EIP-1271) that attempts to re-enter
///         Handshake from the ERC-721 receive hook on the SECOND settlement leg.
///         The taker's NFTs are safeTransferFrom'd to the maker AFTER the maker's
///         NFTs already moved and AFTER all state effects, but before the ETH
///         payouts. onERC721Received fires there; this mock re-enters
///         withdraw/withdrawFees so a test can prove the ReentrancyGuard holds at
///         the maker-side window too (the existing suite only covered taker-side,
///         first-leg re-entry).
///
///         isValidSignature accepts any signature (a permissive test wallet), so
///         it qualifies as a valid EIP-1271 maker without an ECDSA key.
contract ReentrantMaker is IERC721Receiver, IERC1271 {
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

    function depositEscrow() external payable {
        hs.deposit{value: msg.value}();
    }

    function approveCollection(address collection) external {
        IERC721(collection).setApprovalForAll(address(hs), true);
    }

    /// @dev Permissive EIP-1271: this wallet "signs" anything.
    function isValidSignature(bytes32, bytes memory) external pure returns (bytes4) {
        return IERC1271.isValidSignature.selector; // 0x1626ba7e
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        returns (bytes4)
    {
        if (mode == Mode.Withdraw) {
            hs.withdraw(1); // re-enter mid-settlement on the second leg; must revert
        } else if (mode == Mode.WithdrawFees) {
            hs.withdrawFees();
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
