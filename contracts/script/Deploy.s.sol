// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Handshake} from "../src/Handshake.sol";

/// Usage:
///   export ETH_MAINNET_RPC_URL=... PRIVATE_KEY_DEPLOYER=0x... \
///          FEE_RECIPIENT_ADDRESS=0x... CONTRACT_OWNER=0x...
///   # Optional launch allowlist (comma-separated, seeded with no timelock):
///   export INITIAL_COLLECTIONS=0xAbc...,0xDef...
///   npm run contracts:deploy
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = _deployerKey();
        address feeRecipient = vm.envAddress("FEE_RECIPIENT_ADDRESS");
        address contractOwner = vm.envOr("CONTRACT_OWNER", vm.addr(deployerKey));

        // Launch allowlist. Read from INITIAL_COLLECTIONS as a comma-separated
        // address list; default to empty so a deploy without the var seeds no
        // collections (every collection must then go through the ADD_DELAY
        // timelock via proposeCollection). Seeded entries are tradable in the
        // deployment block.
        address[] memory noSeed;
        address[] memory initialCollections =
            vm.envOr("INITIAL_COLLECTIONS", ",", noSeed);

        vm.startBroadcast(deployerKey);
        Handshake settlement =
            new Handshake(contractOwner, feeRecipient, initialCollections);
        vm.stopBroadcast();

        console.log("Handshake deployed at:", address(settlement));
        console.log("Owner:", contractOwner);
        console.log("Fee recipient:", feeRecipient);
        console.log("Fee bps:", settlement.feeBps());
        console.log("Seeded collections:", initialCollections.length);
        for (uint256 i = 0; i < initialCollections.length; i++) {
            console.log("  allowlisted:", initialCollections[i]);
        }
    }

    /// Accepts PRIVATE_KEY_DEPLOYER with or without the 0x prefix.
    function _deployerKey() internal view returns (uint256) {
        string memory raw = vm.envString("PRIVATE_KEY_DEPLOYER");
        if (bytes(raw).length >= 2 && bytes(raw)[0] == "0" && (bytes(raw)[1] == "x" || bytes(raw)[1] == "X")) {
            return vm.parseUint(raw);
        }
        return vm.parseUint(string.concat("0x", raw));
    }
}
