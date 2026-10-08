// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HedgedFloorVault} from "../src/HedgedFloorVault.sol";
import {PerplPriceSource} from "../src/PerplPriceSource.sol";
import {VolFeed} from "../src/VolFeed.sol";
import {CreReceiver} from "../src/CreReceiver.sol";
import {IPerpl} from "../src/interfaces/IPerpl.sol";

/// v2 after the 4 Oct audit. Owner and keeper are separate keys. The keeper posts the pricing vol
/// (step limited); the CRE receiver is only an observer, because the simulation forwarder it trusts
/// does not verify signatures.
/// env: DEPLOYER_PRIVATE_KEY (owner), KEEPER (address), optional INITIAL_VOL (1e18 = 100%)
contract DeployV2 is Script {
    uint256 constant MON = 10;
    address constant CRE_SIM_FORWARDER = 0x9eF6468C5f37b976E57d52054c693269479A784d;

    function run() external returns (HedgedFloorVault vault, PerplPriceSource px, VolFeed vol, CreReceiver rx) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        address keeper = vm.envAddress("KEEPER");
        require(keeper != owner, "keeper must differ from owner");
        IPerpl perpl = IPerpl(vm.envOr("PERPL", address(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F)));
        IERC20 ausd = IERC20(vm.envOr("AUSD", address(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a)));

        vm.startBroadcast(pk);
        px = new PerplPriceSource(perpl);
        vol = new VolFeed(owner);
        vault = new HedgedFloorVault(ausd, px, vol, perpl, owner);
        rx = new CreReceiver(vol, vault, CRE_SIM_FORWARDER, owner);

        vol.setUpdater(keeper, true);
        vol.setObserver(address(rx), true);
        // seed the pricing vol from the last CRE-computed value so the first quote is not a guess
        vol.setUpdater(owner, true);
        vol.update(MON, vm.envOr("INITIAL_VOL", uint256(2.551533e18)), "cre-rv-24h-seed");
        vol.setUpdater(owner, false);

        vault.setKeeper(keeper);
        vault.setMarket(MON, true, "MON");
        vault.setParams(1000, 10, 10, 1 days, 60); // 10% spread, 0.1% floor, 10 s price age
        vault.setMaxHedgeLots(MON, 5_000); // at most 5,000 MON short
        vault.setDemoBuyer(owner, true);
        vm.stopBroadcast();

        console2.log("PerplPriceSource", address(px));
        console2.log("VolFeed", address(vol));
        console2.log("HedgedFloorVault", address(vault));
        console2.log("CreReceiver", address(rx));
    }
}
