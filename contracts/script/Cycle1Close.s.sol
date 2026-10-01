// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {HedgedFloorVault} from "../src/HedgedFloorVault.sol";
import {ProtectionToken} from "../src/ProtectionToken.sol";

/// Mainnet cycle, part 2: settle the expired series and redeem the protection tokens.
/// env: DEPLOYER_PRIVATE_KEY, VAULT, SERIES
contract Cycle1Close is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);
        HedgedFloorVault vault = HedgedFloorVault(vm.envAddress("VAULT"));
        uint256 id = vm.envUint("SERIES");
        ProtectionToken token = vault.getSeries(id).token;

        vm.startBroadcast(pk);
        vault.settle(id);
        uint256 paid = vault.redeem(id, token.balanceOf(me), me);
        vm.stopBroadcast();

        console2.log("payout per token", vault.getSeries(id).payoutPerToken);
        console2.log("redeemed (AUSD 6dp)", paid);
    }
}
