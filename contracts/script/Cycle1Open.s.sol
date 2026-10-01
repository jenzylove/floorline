// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HedgedFloorVault} from "../src/HedgedFloorVault.sol";
import {PerplPriceSource} from "../src/PerplPriceSource.sol";
import {VolFeed} from "../src/VolFeed.sol";

/// First mainnet cycle, part 1: deposit, open a short series, buy protection, open the hedge account, short.
/// env: DEPLOYER_PRIVATE_KEY, VAULT, VOL
contract Cycle1Open is Script {
    uint256 constant MON = 10;
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address me = vm.addr(pk);
        HedgedFloorVault vault = HedgedFloorVault(vm.envAddress("VAULT"));
        VolFeed vol = VolFeed(vm.envAddress("VOL"));
        uint256 deposit = vm.envOr("DEPOSIT", uint256(4.5e6));
        uint256 amount = vm.envOr("AMOUNT", uint256(60e18));
        uint256 hedgeAcct = vm.envOr("HEDGE_ACCT", uint256(1.2e6));
        uint256 lots = vm.envOr("LOTS", uint256(25));
        uint64 expiry = uint64(block.timestamp + vm.envOr("EXPIRY_SECS", uint256(15 minutes)));

        (uint256 spot,) = vault.priceSource().price(MON);
        uint256 strike = spot;

        vm.startBroadcast(pk);
        vol.update(MON, 0.9e18, "manual");
        vault.setMaxHedgeLots(MON, 200);
        AUSD.approve(address(vault), type(uint256).max);
        vault.deposit(deposit, me);
        uint256 id = vault.createSeries(MON, strike, expiry);
        uint256 premium = vault.buy(id, amount, 1e6, me);
        vault.openHedgeAccount(hedgeAcct);
        vault.hedge(MON, true, lots, spot / 2);
        vm.stopBroadcast();

        console2.log("series", id);
        console2.log("expiry", expiry);
        console2.log("strike", strike);
        console2.log("premium", premium);
        console2.log("short lots", vault.shortLots(MON));
        console2.log("hedge equity", vault.hedgeEquity());
    }
}
