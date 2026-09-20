// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentTreasury} from "../src/AgentTreasury.sol";
import {MockUSD} from "../src/MockUSD.sol";

/// @notice Deploys the settlement token and the treasury, then mints demo capital.
///
/// HashKey Chain testnet (chainId 133):
///   forge script script/Deploy.s.sol --rpc-url https://testnet.hsk.xyz --broadcast --private-key $PK
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        MockUSD usd = new MockUSD();
        AgentTreasury treasury = new AgentTreasury();
        usd.mint(deployer, 1_000_000e6); // $1M of play money for the demo

        vm.stopBroadcast();

        console.log("chainId      ", block.chainid);
        console.log("deployer     ", deployer);
        console.log("MockUSD      ", address(usd));
        console.log("AgentTreasury", address(treasury));
    }
}
