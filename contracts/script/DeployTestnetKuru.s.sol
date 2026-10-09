// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FloorVault} from "../src/FloorVault.sol";
import {PerplPriceSource} from "../src/PerplPriceSource.sol";
import {VolFeed} from "../src/VolFeed.sol";
import {IPerpl} from "../src/interfaces/IPerpl.sol";

/// Monad testnet copy of Floorline for the Kuru Spot V2 leg: Kuru market creation is owner-only on
/// V2, so Kuru lists a market for one long-dated series token against Kuru testnet USDC (their choice;
/// the vault takes the same USDC, so protection is bought and traded with one token).
/// Same contracts as mainnet, priced from Perpl's testnet MON market (id 64). No Perpl hedge here. Collateral is 6-decimal USDC, same as AUSD on mainnet.
/// Run: forge script script/DeployTestnetKuru.s.sol --rpc-url monad_testnet --broadcast --account fl-owner --password-file <file>
contract DeployTestnetKuru is Script {
    uint256 constant MON = 64; // Perpl testnet MON perp
    IPerpl constant PERPL = IPerpl(0x1964C32f0bE608E7D29302AFF5E61268E72080cc);
    IERC20 constant USDC = IERC20(0xA402B424f392EAA05DBc8779e4502A1F6A96fEF1); // Kuru testnet USDC, quote of Kuru V2 testnet markets
    uint64 constant EXPIRY = 1793491200; // 31 Oct 2026 00:00 UTC, past the end of judging

    function run() external returns (FloorVault vault, PerplPriceSource px, VolFeed vol, uint256 seriesId, address token) {
        vm.startBroadcast();
        address owner = msg.sender;
        px = new PerplPriceSource(PERPL);
        vol = new VolFeed(owner);
        vault = new FloorVault(USDC, px, vol, owner);
        vol.setUpdater(owner, true);
        vol.update(MON, 1.4e18, "perpl-rv-24h-mainnet"); // mainnet's last keeper value, 9 Oct
        vault.setKeeper(owner);
        vault.setMarket(MON, true, "MON");
        // testnet: vol stays valid for 30 days (no keeper here posting it), price age as mainnet
        vault.setParams(1000, 10, 60, 30 days, 60);

        (uint256 spot,) = px.price(MON);
        uint256 strike = (spot * 90 / 100) / 100 * 100; // 10% below, rounded
        seriesId = vault.createSeries(MON, strike, EXPIRY);
        token = address(vault.getSeries(seriesId).token);
        vm.stopBroadcast();

        console2.log("FloorVault (testnet)", address(vault));
        console2.log("PerplPriceSource (testnet)", address(px));
        console2.log("VolFeed (testnet)", address(vol));
        console2.log("strike", strike);
        console2.log("Protection token (Kuru base)", token);
    }
}
