// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IERC165Like {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IERC721MetaLike {
    function name() external view returns (string memory);
}

/// @notice Fork test that hardens the launch allowlist against the residual risk
///         HandshakeUpgradeableRisk.t.sol demonstrates in the abstract: it checks
///         the REAL seeded Ethereum collections. For each one it verifies, against
///         live mainnet state, that the collection is:
///           - a deployed contract,
///           - NOT an upgradeable proxy (EIP-1967 / beacon slots empty) — a
///             proxy would let its owner swap in a lying ownerOf and reopen the
///             original HIGH finding, so this is asserted HARD,
///           - claiming the ERC-721 interface, and
///           - freely transferable (a sampled token can move) — a royalty-
///             enforcing / soulbound transfer hook that reverts would make
///             Handshake._transferNFTs revert (a per-collection DoS). This is
///             reported, not asserted, since it is a UX break, not a theft.
///
///         The test SKIPS cleanly when ETH_MAINNET_RPC_URL is unset, so it never
///         breaks CI; run it locally/nightly with:
///           ETH_MAINNET_RPC_URL=https://rpc.ethereum.xyz forge test --match-contract \
///             HandshakeForkCollections -vvv
contract HandshakeForkCollections is Test {
    // EIP-1967 implementation & beacon slots, and EIP-1822 (UUPS) proxiable slot.
    bytes32 internal constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    bytes32 internal constant BEACON_SLOT =
        0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50;
    bytes32 internal constant PROXIABLE_SLOT =
        0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bec8;

    bytes4 internal constant ERC721_INTERFACE_ID = 0x80ac58cd;

    address[] internal collections;
    string[] internal names;

    function setUp() public {
        // The seven collections seeded onto the deployed Handshake allowlist
        // (mirrors lib/featured-collections.ts). Override with SEEDED_COLLECTIONS
        // (comma-separated) if the deployed set changes.
        address[] memory fallbackList = new address[](7);
        fallbackList[0] = 0x818030837E8350ba63E64d7dC01A547fA73c8279; // 10kSquad
        fallbackList[1] = 0x2a0001f3D4c98881376F8d36B3C61f163d84a095; // Erebus
        fallbackList[2] = 0x200723A706de0013316E5cd8EBa2b3f53DD90c29; // r3tards
        fallbackList[3] = 0x36982448e77658b8F58F4665696e3173D1e696C2; // Molandaks
        fallbackList[4] = 0xcbdFaD1bfb6A4414DD4D84B7A6420dc43683deB0; // Roarrr
        fallbackList[5] = 0xaEAA920165fD7ce58a0E0772Ffc97F06626572cD; // Sealuminati
        fallbackList[6] = 0x9F8514cEBee138b61806d4651f51d26C8098b463; // The Daks

        collections = vm.envOr("SEEDED_COLLECTIONS", ",", fallbackList);

        names = new string[](7);
        names[0] = "10kSquad";
        names[1] = "Erebus";
        names[2] = "r3tards";
        names[3] = "Molandaks";
        names[4] = "Roarrr";
        names[5] = "Sealuminati";
        names[6] = "The Daks";
    }

    function test_SeededCollections_AreNonUpgradeable_And_Transferable() public {
        string memory rpc = vm.envOr("ETH_MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            console.log("ETH_MAINNET_RPC_URL unset - skipping fork checks.");
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        for (uint256 i = 0; i < collections.length; i++) {
            address c = collections[i];
            string memory label = i < names.length ? names[i] : "collection";
            console.log("---", label, c);

            // 1. Must be a deployed contract (HARD).
            assertGt(c.code.length, 0, "seeded collection has no code on Ethereum");

            // 2. Must NOT be an upgradeable proxy (HARD): a mutable implementation
            //    can later lie in ownerOf and reopen the theft vector.
            bool upgradeable = vm.load(c, IMPL_SLOT) != bytes32(0)
                || vm.load(c, BEACON_SLOT) != bytes32(0)
                || vm.load(c, PROXIABLE_SLOT) != bytes32(0);
            if (upgradeable) {
                console.log("  UPGRADEABLE PROXY DETECTED - do not allowlist:", label);
            }
            assertFalse(upgradeable, "seeded collection is an upgradeable proxy");

            // 3. Should claim the ERC-721 interface (reported).
            try IERC165Like(c).supportsInterface(ERC721_INTERFACE_ID) returns (bool ok) {
                if (!ok) console.log("  WARN: does not report ERC721 via ERC165");
            } catch {
                console.log("  WARN: no ERC165 supportsInterface");
            }

            // 4. Sampled-token transfer must not revert (reported, not asserted):
            //    a soulbound / royalty-enforcing transfer hook would DoS trades
            //    of this collection.
            _probeTransfer(c);
        }
    }

    /// @dev Find a real holder of an early token id and attempt to move it. Logs
    ///      whether the transfer succeeds so a reverting transfer hook (soulbound
    ///      / enforced royalties) surfaces as a per-collection warning.
    function _probeTransfer(address c) internal {
        for (uint256 id = 0; id <= 3; id++) {
            address holder;
            try IERC721(c).ownerOf(id) returns (address o) {
                holder = o;
            } catch {
                continue; // token id doesn't exist; try the next
            }
            if (holder == address(0)) continue;

            address sink = makeAddr("forkTransferSink");
            vm.prank(holder);
            try IERC721(c).transferFrom(holder, sink, id) {
                console.log("  transfer OK (freely transferable)");
            } catch {
                console.log("  WARN: transfer REVERTED - soulbound/royalty hook? DoS risk");
            }
            return; // one sample is enough
        }
        console.log("  note: no sampled token id 0-3 found; transfer not probed");
    }
}
