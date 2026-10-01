// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HedgedFloorVault} from "../src/HedgedFloorVault.sol";
import {VolFeed} from "../src/VolFeed.sol";

/// Mainnet cycle, part 1: set vol, deposit, open a short series at the money, buy protection.
/// The hedge is NOT done here: the off-chain Perpl API bot reads the vault and shorts from its own funded account.
/// env: DEPLOYER_PRIVATE_KEY, VAULT, VOL; optional DEPOSIT (AUSD 6dp), AMOUNT (MON 1e18), EXPIRY_SECS
contract Cycle1Open is Script {
    uint256 constant MON = 10;
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);
        HedgedFloorVault vault = HedgedFloorVault(vm.envAddress("VAULT"));
        VolFeed vol = VolFeed(vm.envAddress("VOL"));
        uint256 deposit = vm.envOr("DEPOSIT", uint256(4.7e6));
        uint256 amount = vm.envOr("AMOUNT", uint256(140e18));
        uint64 expiry = uint64(block.timestamp + vm.envOr("EXPIRY_SECS", uint256(15 minutes)));

        (uint256 spot,) = vault.priceSource().price(MON);

        vm.startBroadcast(pk);
        vol.update(MON, 0.9e18, "manual");
        AUSD.approve(address(vault), type(uint256).max);
        vault.deposit(deposit, me);
        uint256 id = vault.createSeries(MON, spot, expiry);
        uint256 premium = vault.buy(id, amount, 1e6, me);
        vm.stopBroadcast();

        console2.log("series", id);
        console2.log("expiry", expiry);
        console2.log("strike", spot);
        console2.log("premium", premium);
        console2.log("locked", vault.getSeries(id).locked);
    }
}
