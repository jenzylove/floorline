// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HedgedFloorVault} from "../../src/HedgedFloorVault.sol";
import {FloorVault} from "../../src/FloorVault.sol";
import {PerplPriceSource} from "../../src/PerplPriceSource.sol";
import {VolFeed} from "../../src/VolFeed.sol";
import {IPerpl} from "../../src/interfaces/IPerpl.sol";

/// Runs against a fork of Monad mainnet: real AUSD, real Perpl order book and oracle.
/// forge test --match-path test/fork/* --fork-url monad
contract PerplForkTest is Test {
    IPerpl constant PERPL = IPerpl(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    uint256 constant MON = 10;

    HedgedFloorVault vault;
    PerplPriceSource px;
    VolFeed vol;
    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address lp = makeAddr("lp");
    address buyer = makeAddr("buyer");

    function setUp() public {
        vm.createSelectFork("monad");
        px = new PerplPriceSource(PERPL);
        vol = new VolFeed(owner);
        vault = new HedgedFloorVault(AUSD, px, vol, PERPL, owner);
        vm.startPrank(owner);
        vol.setUpdater(keeper, true);
        vault.setKeeper(keeper);
        vault.setMarket(MON, true, "MON");
        vault.setMaxHedgeLots(MON, 20_000);
        vault.setParams(1000, 10, 120, 1 days, 60);
        vm.stopPrank();
        vm.prank(keeper);
        vol.update(MON, 0.9e18, "test");

        _fund(lp, 1_000e6);
        _fund(buyer, 100e6);
        vm.prank(lp);
        AUSD.approve(address(vault), type(uint256).max);
        vm.prank(lp);
        vault.deposit(1_000e6, lp);
        vm.prank(buyer);
        AUSD.approve(address(vault), type(uint256).max);
    }

    function _fund(address to, uint256 amt) internal {
        vm.prank(address(PERPL)); // Perpl holds plenty of AUSD on mainnet
        AUSD.transfer(to, amt);
    }

    /// Audit H4: the keeper cannot hedge at a price far from Perpl's oracle (no value leak to its own orders).
    function test_hedgePriceMustStayNearOracle() public {
        (uint256 spot,) = px.price(MON);
        vm.prank(keeper);
        vault.openHedgeAccount(50e6);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(HedgedFloorVault.HedgePriceOutOfBand.selector, spot / 2, spot));
        vault.hedge(MON, true, 100, spot / 2); // selling at half the oracle price
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(HedgedFloorVault.HedgePriceOutOfBand.selector, spot * 2, spot));
        vault.hedge(MON, false, 100, spot * 2); // buying back at twice the oracle price
    }

    /// The live mark price is readable and close to the oracle, so the buy guard works on mainnet data.
    function test_markIsReadableAndNearOracle() public view {
        (uint256 p,) = px.price(MON);
        (uint256 m,) = px.mark(MON);
        assertGt(m, 0);
        assertApproxEqRel(m, p, 0.05e18);
    }

    function test_priceSourceReadsPerplOracle() public {
        (uint256 p, uint256 t) = px.price(MON);
        emit log_named_uint("MON price (AUSD 6dp)", p);
        emit log_named_uint("age (s)", block.timestamp - t);
        assertGt(p, 1_000); // above $0.001
        assertLt(p, 10_000_000); // below $10
        assertLe(block.timestamp - t, 300);
    }

    function test_buyThenHedgeOnPerpl() public {
        (uint256 spot,) = px.price(MON);
        vm.prank(keeper);
        uint256 id = vault.createSeries(MON, spot * 90 / 100, uint64(block.timestamp + 1 days));

        vm.prank(buyer);
        uint256 premium = vault.buy(id, 10_000e18, 10e6, buyer);
        emit log_named_uint("premium for 10k MON, 1 day, 10% below", premium);
        uint256 locked = vault.getSeries(id).locked;
        assertEq(locked, (spot * 90 / 100) * 10_000);

        vm.startPrank(keeper);
        vault.openHedgeAccount(50e6);
        vault.hedge(MON, true, 1_000, spot * 99 / 100); // sell 1,000 MON (~$31 at 1x), accept down to 1% below oracle
        vm.stopPrank();

        assertEq(vault.shortLots(MON), 1_000);
        uint256 eq = vault.hedgeEquity();
        emit log_named_uint("hedge equity", eq);
        assertApproxEqRel(eq, 50e6, 0.02e18); // fees and spread only
        // backing still intact: locked collateral never left the vault
        assertGe(AUSD.balanceOf(address(vault)), vault.totalLocked() + vault.totalOwed());
        emit log_named_uint("totalAssets", vault.totalAssets());
    }

    function test_hedgeCapAndRoles() public {
        (uint256 spot,) = px.price(MON);
        vm.prank(keeper);
        vault.openHedgeAccount(50e6);

        vm.prank(keeper);
        vm.expectRevert();
        vault.hedge(MON, true, 20_001, spot * 99 / 100);

        vm.prank(buyer);
        vm.expectRevert(FloorVault.NotKeeper.selector);
        vault.hedge(MON, true, 100, spot * 99 / 100);

        vm.prank(buyer);
        vm.expectRevert(FloorVault.NotKeeper.selector);
        vault.defundHedge(1e6);
    }

    function test_hedgeMoneyOnlyFromFreeAssetsAndComesBack() public {
        (uint256 spot,) = px.price(MON);
        vm.prank(keeper);
        uint256 id = vault.createSeries(MON, spot, uint64(block.timestamp + 1 days));
        _fund(buyer, 1_000e6);
        vm.prank(buyer);
        vault.buy(id, 500e6 * 1e18 / spot, 100e6, buyer); // locks ~500 AUSD, whatever MON trades at

        uint256 free = vault.freeAssets();
        vm.prank(keeper);
        vm.expectRevert();
        vault.openHedgeAccount(free + 1);

        vm.prank(keeper);
        vault.openHedgeAccount(20e6);
        uint256 balBefore = AUSD.balanceOf(address(vault));
        vm.prank(keeper);
        vault.defundHedge(5e6);
        assertEq(AUSD.balanceOf(address(vault)), balBefore + 5e6);
    }
}
