// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {FloorVault} from "../src/FloorVault.sol";
import {VolFeed} from "../src/VolFeed.sol";
import {MockAUSD, MockPriceSource} from "./mocks/Mocks.sol";

/// Properties of pricing and settlement over random floors, sizes, lengths and end prices.
contract FuzzTest is Test {
    uint256 constant MON = 10;
    uint256 constant SPOT = 30_000; // $0.03, 6 decimals

    MockAUSD ausd;
    MockPriceSource px;
    VolFeed vol;
    FloorVault vault;

    address owner = makeAddr("owner");
    address keeper = makeAddr("keeper");
    address lp = makeAddr("lp");
    address buyer = makeAddr("buyer");

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

        px.set(MON, SPOT);
        vm.prank(keeper);
        vol.update(MON, 1.4e18, "test");

        ausd.mint(lp, 100_000e6);
        vm.startPrank(lp);
        ausd.approve(address(vault), type(uint256).max);
        vault.deposit(100_000e6, lp);
        vm.stopPrank();

        ausd.mint(buyer, 100_000e6);
        vm.prank(buyer);
        ausd.approve(address(vault), type(uint256).max);
    }

    function _series(uint256 strike, uint256 ttl) internal returns (uint256 id) {
        vm.prank(keeper);
        id = vault.createSeries(MON, strike, uint64(block.timestamp + ttl));
    }

    /// Buying any floor locks exactly its largest possible payout, and never costs more than that payout.
    function testFuzz_buyLocksTheWholePayout(uint256 strike, uint256 units, uint256 ttl) public {
        strike = bound(strike, SPOT / 2, SPOT * 3 / 2);
        units = bound(units, 1, 1_000_000);
        ttl = bound(ttl, 1 hours, 30 days);
        uint256 id = _series(strike, ttl);

        uint256 quoted = vault.quote(id, units * 1e18);
        vm.prank(buyer);
        uint256 premium = vault.buy(id, units * 1e18, type(uint256).max, buyer);

        assertEq(premium, quoted, "the quote is the price");
        assertEq(vault.getSeries(id).locked, units * strike, "locked the full payout");
        assertGe(ausd.balanceOf(address(vault)), vault.totalLocked(), "the vault holds what it locked");
        // across the floors the keeper lists (up to 50% above the price) a buyer never pays more than the floor can pay
        assertLe(premium, units * strike, "premium never exceeds the largest payout");
    }

    /// At the end date the holder gets exactly the gap below the floor, and depositors keep the rest.
    function testFuzz_settlePaysExactlyTheGap(uint256 strike, uint256 units, uint256 end) public {
        strike = bound(strike, SPOT / 2, SPOT * 3 / 2);
        units = bound(units, 1, 1_000_000);
        end = bound(end, 1, SPOT * 3);
        uint256 id = _series(strike, 1 days);

        vm.prank(buyer);
        uint256 premium = vault.buy(id, units * 1e18, type(uint256).max, buyer);

        vm.warp(block.timestamp + 1 days);
        px.set(MON, end);
        vault.settle(id);

        uint256 gap = strike > end ? strike - end : 0;
        uint256 before = ausd.balanceOf(buyer);
        vm.prank(buyer);
        uint256 paid = vault.redeem(id, units * 1e18, buyer);

        assertEq(paid, gap * units, "paid the gap, nothing else");
        assertEq(ausd.balanceOf(buyer), before + paid);
        assertLe(paid, units * strike, "never more than was locked");
        assertEq(vault.totalLocked(), 0, "nothing stays locked after settlement");
        assertEq(vault.totalOwed(), 0, "nothing stays owed after the redeem");
        assertEq(vault.totalAssets(), 100_000e6 + premium - paid, "depositors: deposits plus premium minus payout");
    }

    /// A lower floor never costs more than a higher one with the same end date.
    function testFuzz_lowerFloorsCostLess(uint256 a, uint256 b, uint256 units) public {
        a = bound(a, SPOT / 2, SPOT * 3 / 2);
        b = bound(b, a, SPOT * 3 / 2);
        units = bound(units, 100, 1_000_000);
        uint256 low = _series(a, 7 days);
        uint256 high = _series(b, 7 days);
        assertLe(vault.quote(low, units * 1e18), vault.quote(high, units * 1e18) + 1);
    }

    /// The same floor for longer never costs less.
    function testFuzz_longerCostsMore(uint256 strike, uint256 t1, uint256 t2) public {
        strike = bound(strike, SPOT / 2, SPOT * 3 / 2);
        t1 = bound(t1, 1 hours, 30 days);
        t2 = bound(t2, t1, 30 days);
        uint256 shorter = _series(strike, t1);
        uint256 longer = _series(strike, t2);
        assertLe(vault.quote(shorter, 10_000e18), vault.quote(longer, 10_000e18) + 2);
    }

    /// Splitting a purchase in two never beats buying it at once by more than rounding.
    function testFuzz_noGainFromSplittingABuy(uint256 strike, uint256 units, uint256 cut) public {
        strike = bound(strike, SPOT / 2, SPOT * 3 / 2);
        units = bound(units, 2, 1_000_000);
        cut = bound(cut, 1, units - 1);
        uint256 id = _series(strike, 7 days);
        uint256 whole = vault.quote(id, units * 1e18);
        uint256 parts = vault.quote(id, cut * 1e18) + vault.quote(id, (units - cut) * 1e18);
        assertGe(parts + 2, whole, "two small buys are not cheaper than one");
    }
}
