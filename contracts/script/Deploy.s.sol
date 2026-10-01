// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HedgedFloorVault} from "../src/HedgedFloorVault.sol";
import {PerplPriceSource} from "../src/PerplPriceSource.sol";
import {VolFeed} from "../src/VolFeed.sol";
import {IPerpl} from "../src/interfaces/IPerpl.sol";

/// Deploys the price source, vol feed and vault, and enables MON.
/// env: DEPLOYER_PRIVATE_KEY, KEEPER (address), optional PERPL, AUSD
contract Deploy is Script {
    function run() external returns (HedgedFloorVault vault, PerplPriceSource px, VolFeed vol) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        address keeper = vm.envOr("KEEPER", owner);
        IPerpl perpl = IPerpl(vm.envOr("PERPL", address(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F)));
        IERC20 ausd = IERC20(vm.envOr("AUSD", address(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a)));

        vm.startBroadcast(pk);
        px = new PerplPriceSource(perpl);
        vol = new VolFeed(owner);
        vault = new HedgedFloorVault(ausd, px, vol, perpl, owner);
        vol.setUpdater(keeper, true);
        vault.setKeeper(keeper);
        vault.setMarket(10, true, "MON");
        vault.setParams(1000, 10, 120, 1 days, 60);
        vm.stopBroadcast();

        console2.log("PerplPriceSource", address(px));
        console2.log("VolFeed", address(vol));
        console2.log("HedgedFloorVault", address(vault));
    }
}
