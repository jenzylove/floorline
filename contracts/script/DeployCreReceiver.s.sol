// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {CreReceiver} from "../src/CreReceiver.sol";
import {FloorVault} from "../src/FloorVault.sol";
import {VolFeed} from "../src/VolFeed.sol";

/// Deploys the CRE consumer and authorises it on the VolFeed.
/// env: DEPLOYER_PRIVATE_KEY, VAULT, VOL, FORWARDER (CRE simulation or production forwarder)
contract DeployCreReceiver is Script {
    function run() external returns (CreReceiver rx) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        VolFeed vol = VolFeed(vm.envAddress("VOL"));
        vm.startBroadcast(pk);
        rx = new CreReceiver(vol, FloorVault(vm.envAddress("VAULT")), vm.envAddress("FORWARDER"), vm.addr(pk));
        vol.setUpdater(address(rx), true);
        vm.stopBroadcast();
        console2.log("CreReceiver", address(rx));
    }
}
