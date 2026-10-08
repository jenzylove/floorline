// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {FloorVault} from "../src/FloorVault.sol";
import {VolFeed} from "../src/VolFeed.sol";
import {MockAUSD, MockPriceSource} from "./mocks/Mocks.sol";

/// The audit fixes of 4 Oct 2026: settle window, stale and lagging prices, short demo series,
/// deposits while the valuation is stale, emergency settle, and the vol step limit.
contract GuardsTest is Test {
    uint256 constant MON = 10;

    MockAUSD ausd;
    MockPriceSource px;
    VolFeed vol;
    FloorVault vault;

    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address lp = makeAddr("lp");
    address buyer = makeAddr("buyer");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_790_000_000);
        ausd = new MockAUSD();
        px = new MockPriceSource();
        vol = new VolFeed(owner);
        vault = new FloorVault(ausd, px, vol, owner);

        vm.startPrank(owner);
        vol.setUpdater(keeper, true);
        vault.setKeeper(keeper);
        vault.setMarket(MON, true, "MON");
        vm.stopPrank();

        px.set(MON, 30_000);
        vm.prank(keeper);
        vol.update(MON, 2.5e18, "test");

        ausd.mint(lp, 10_000e6);
        vm.startPrank(lp);
        ausd.approve(address(vault), type(uint256).max);
        vault.deposit(10_000e6, lp);
        vm.stopPrank();

        for (uint256 i; i < 2; ++i) {
            address b = i == 0 ? buyer : stranger;
            ausd.mint(b, 1_000e6);
            vm.prank(b);
            ausd.approve(address(vault), type(uint256).max);
        }
    }

    function _series(uint256 strike, uint64 ttl) internal returns (uint256 id) {
        vm.prank(keeper);
        id = vault.createSeries(MON, strike, uint64(block.timestamp) + ttl);
    }

    // ------------------------------------------------------------- settle window (H1)

    function test_settleInsideWindowByAnyone() public {
        uint256 id = _series(30_000, 1 hours);
        vm.prank(buyer);
        vault.buy(id, 1_000e18, 5e6, buyer);
        vm.warp(block.timestamp + 1 hours + 30);
        px.set(MON, 20_000);
        vm.prank(stranger);
        vault.settle(id);
        assertEq(vault.getSeries(id).settlePrice, 20_000);
    }

    function test_holderCannotWaitForADipAfterTheWindow() public {
        uint256 id = _series(30_000, 1 hours);
        vm.prank(buyer);
        vault.buy(id, 1_000e18, 5e6, buyer);
        uint256 expiry = vault.getSeries(id).expiry;
        vm.warp(expiry + 1 hours); // nobody settled; price dips an hour later
        px.set(MON, 10_000);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(FloorVault.SettleWindowMissed.selector, expiry + 1 hours, expiry + 120));
        vault.settle(id);
        // only the owner can settle late, and it is logged
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit FloorVault.SettledLate(id, owner, false);
        vault.settle(id);
    }

    function test_emergencySettleOnlyAfterGrace() public {
        uint256 id = _series(30_000, 1 hours);
        vm.prank(buyer);
        vault.buy(id, 1_000e18, 5e6, buyer);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(owner);
        vm.expectRevert(FloorVault.TooEarlyForEmergency.selector);
        vault.emergencySettle(id, 25_000);

        vm.warp(block.timestamp + 1 days);
        vm.prank(stranger);
        vm.expectRevert();
        vault.emergencySettle(id, 25_000);

        vm.prank(owner);
        vault.emergencySettle(id, 25_000);
        FloorVault.Series memory s = vault.getSeries(id);
        assertTrue(s.settled);
        assertEq(s.payoutPerToken, 5_000);
        assertEq(s.owed, 5e6);
    }

    // ------------------------------------------------------------- stale and lagging price (H2)

    function test_buyRejectsPriceOlderThanTenSeconds() public {
        uint256 id = _series(30_000, 7 days);
        vm.warp(block.timestamp + 11);
        vm.prank(buyer);
        vm.expectRevert();
        vault.buy(id, 1e18, type(uint256).max, buyer);
    }

    function test_buyRejectsWhenMarkMovedAwayFromOracle() public {
        uint256 id = _series(30_000, 7 days);
        px.setMark(MON, 29_000); // market fell 3.3%, the oracle has not caught up
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(FloorVault.PriceDisagreement.selector, 30_000, 29_000));
        vault.buy(id, 1_000e18, type(uint256).max, buyer);

        px.setMark(MON, 29_800); // within 1%
        vm.prank(buyer);
        vault.buy(id, 1_000e18, type(uint256).max, buyer);
    }

    // ------------------------------------------------------------- short demo series

    function test_shortSeriesAreAllowlistOnlyAndCostMore() public {
        uint256 longId = _series(30_000, 1 hours);
        uint256 shortId = _series(30_000, 15 minutes);
        assertFalse(vault.isShortTenor(longId));
        assertTrue(vault.isShortTenor(shortId));

        vm.prank(stranger);
        vm.expectRevert(FloorVault.RestrictedSeries.selector);
        vault.buy(shortId, 1_000e18, type(uint256).max, stranger);

        vm.prank(owner);
        vault.setDemoBuyer(buyer, true);
        uint256 q = vault.quote(shortId, 1_000e18);
        vm.prank(buyer);
        assertEq(vault.buy(shortId, 1_000e18, type(uint256).max, buyer), q);

        // same strike, 15 min: fair value scales with sqrt(time); the extra 20% spread is on top
        vm.prank(owner);
        vault.setGuards(120, 100, 0, 2000); // turn the tenor rule off to price both alike
        uint256 noExtra = vault.quote(shortId, 1_000e18);
        assertGt(q, noExtra);
    }

    // ------------------------------------------------------------- deposits while stale (M1)

    function test_depositWaitsForFreshValuation() public {
        uint256 id = _series(30_000, 7 days);
        vm.prank(buyer);
        vault.buy(id, 10_000e18, 50e6, buyer);
        assertTrue(vault.valuationFresh());

        vm.warp(block.timestamp + 1 minutes); // price now stale: open protection counted at full collateral
        assertFalse(vault.valuationFresh());
        ausd.mint(stranger, 1_000e6);
        vm.prank(stranger);
        vm.expectRevert(FloorVault.StaleValuation.selector);
        vault.deposit(1_000e6, stranger);

        px.set(MON, 30_000);
        vm.prank(stranger);
        vault.deposit(100e6, stranger);
    }

    // ------------------------------------------------------------- vol step limit (C1)

    function test_volCannotJumpInOneUpdate() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(VolFeed.VolStepTooLarge.selector, 2.5e18, 0.1e18));
        vol.update(MON, 0.1e18, "spoof");

        vm.prank(keeper);
        vol.update(MON, 1.25e18, "ok"); // -50% is the limit
        (uint256 v,) = vol.get(MON);
        assertEq(v, 1.25e18);
    }

    function test_observedVolNeverPricesProtection() public {
        address obs = makeAddr("observer");
        vm.prank(owner);
        vol.setObserver(obs, true);
        uint256 id = _series(30_000, 7 days);
        uint256 before = vault.quote(id, 1_000e18);
        vm.prank(obs);
        vol.observe(MON, 0.1e18, "cre");
        assertEq(vault.quote(id, 1_000e18), before);
    }
}
