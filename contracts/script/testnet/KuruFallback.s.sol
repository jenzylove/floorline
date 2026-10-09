// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FloorVault} from "../../src/FloorVault.sol";
import {PerplPriceSource} from "../../src/PerplPriceSource.sol";
import {VolFeed} from "../../src/VolFeed.sol";
import {IPerpl} from "../../src/interfaces/IPerpl.sol";
import {TestDollar} from "./TestDollar.sol";

interface IKuruRouter {
    function deployProxy(
        uint8 _type,
        address _baseAssetAddress,
        address _quoteAssetAddress,
        uint96 _sizePrecision,
        uint32 _pricePrecision,
        uint32 _tickSize,
        uint96 _minSize,
        uint96 _maxSize,
        uint256 _takerFeeBps,
        uint256 _makerFeeBps,
        uint96 _kuruAmmSpread
    ) external returns (address proxy);
}

interface IKuruMargin {
    function deposit(address _user, address _token, uint256 _amount) external payable;
}

interface IKuruBook {
    function addSellOrder(uint32 _price, uint96 size, bool _postOnly) external;
    function addBuyOrder(uint32 _price, uint96 size, bool _postOnly) external;
}

/// Kuru fallback on Monad testnet, while Kuru's team (travelling) lists the Spot V2 market on Monday:
/// Kuru's older router is still permissionless, so we list Floorline protection on Kuru's order book
/// ourselves and trade it. Collateral and quote is a test dollar (no public faucet for Kuru USDC or AUSD).
///
/// Steps, all on chain:
///  1. test dollar; vault on it, priced from Perpl's testnet MON perp; a series to 31 Oct
///  2. Kuru market: protection token / tUSD, on Kuru's older Router
///  3. owner deposits tUSD into the vault and buys protection on 5,000 MON
///  4. (cast) owner moves protection tokens into Kuru's margin account and posts a sell order
///  5. (cast) a second wallet (the keeper) deposits tUSD into Kuru and buys part of it: a fill on Kuru's book
///
/// env: DEPLOYER_PRIVATE_KEY, KEEPER_PRIVATE_KEY
contract KuruFallback is Script {
    uint256 constant MON = 64; // Perpl testnet MON perp
    IPerpl constant PERPL = IPerpl(0x1964C32f0bE608E7D29302AFF5E61268E72080cc);
    IKuruRouter constant ROUTER = IKuruRouter(0x7EFbE105Ca7415dE98F96622173458ac1c054630);
    IKuruMargin constant MARGIN = IKuruMargin(0xd029C2D98ff85D8F64799017fE00a59B1159CE02);
    uint64 constant EXPIRY = 1793491200; // 31 Oct 2026 00:00 UTC

    // Kuru market settings: price in 1e-6 tUSD per token, size in 1e-6 tokens
    uint32 constant PRICE_PRECISION = 1_000_000;
    uint96 constant SIZE_PRECISION = 1_000_000;

    function run() external {
        uint256 ownerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 keeperPk = vm.envUint("KEEPER_PRIVATE_KEY");
        address owner = vm.addr(ownerPk);
        address buyer = vm.addr(keeperPk);

        // 1-3: tokens, vault, series, market, protection
        vm.startBroadcast(ownerPk);
        TestDollar usd = new TestDollar();
        usd.mint(owner, 1_000e6);
        usd.mint(buyer, 100e6);
        PerplPriceSource px = new PerplPriceSource(PERPL);
        VolFeed vol = new VolFeed(owner);
        FloorVault vault = new FloorVault(IERC20(address(usd)), px, vol, owner);
        vol.setUpdater(owner, true);
        vol.update(MON, 1.4e18, "perpl-rv-24h-mainnet");
        vault.setKeeper(owner);
        vault.setMarket(MON, true, "MON");
        vault.setParams(1000, 10, 60, 30 days, 60);
        (uint256 spot,) = px.price(MON);
        uint256 strike = (spot * 90 / 100) / 100 * 100;
        uint256 sid = vault.createSeries(MON, strike, EXPIRY);
        address token = address(vault.getSeries(sid).token);

        address book = ROUTER.deployProxy(0, token, address(usd), SIZE_PRECISION, PRICE_PRECISION, 1, 10_000, 1_000_000_000_000, 30, 10, 100);

        usd.approve(address(vault), type(uint256).max);
        vault.deposit(500e6, owner);
        uint256 protectUnits = 5_000;
        uint256 premium = vault.buy(sid, protectUnits * 1e18, type(uint256).max, owner);
        uint256 fair = premium * 1e6 / protectUnits / 1e6; // tUSD (6dp) per token, rounded down
        if (fair == 0) fair = 1;

        uint32 ask = uint32(fair * 102 / 100); // fair is already in 1e-6 tUSD units = PRICE_PRECISION
        vm.stopBroadcast();
        // Steps 4 and 5 (Kuru margin deposits and orders) run as separate transactions after this script:
        // forge's on-chain re-simulation cannot see tokens minted earlier in the same run on Monad testnet.

        console2.log("TestDollar tUSD", address(usd));
        console2.log("FloorVault (tUSD)", address(vault));
        console2.log("PerplPriceSource", address(px));
        console2.log("strike (6dp)", strike);
        console2.log("protection token", token);
        console2.log("Kuru market (older router)", book);
        console2.log("premium for 5,000 MON (6dp)", premium);
        console2.log("ask price (1e-6 tUSD per token)", uint256(ask));
    }
}
