// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {FloorVault} from "../src/FloorVault.sol";
import {VolFeed} from "../src/VolFeed.sol";
import {ProtectionToken} from "../src/ProtectionToken.sol";
import {MockAUSD, MockPriceSource} from "./mocks/Mocks.sol";

contract FloorVaultTest is Test {
    uint256 constant MON = 10;

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

        px.set(MON, 30_000); // $0.030
        vm.prank(keeper);
        vol.update(MON, 0.9e18, "test");

        ausd.mint(lp, 10_000e6);
        vm.startPrank(lp);
        ausd.approve(address(vault), type(uint256).max);
        vault.deposit(10_000e6, lp);
        vm.stopPrank();

        ausd.mint(buyer, 1_000e6);
        vm.prank(buyer);
        ausd.approve(address(vault), type(uint256).max);
    }

    function _series(uint256 strike, uint64 ttl) internal returns (uint256 id) {
        vm.prank(keeper);
        id = vault.createSeries(MON, strike, uint64(block.timestamp) + ttl);
    }

    function test_createSeriesNamesToken() public {
        uint256 id = _series(25_000, 7 days);
        ProtectionToken t = vault.getSeries(id).token;
        assertEq(t.symbol(), "flMON-P-0");
        assertEq(t.name(), string.concat("Floorline MON below 0.025 @", vm.toString(block.timestamp + 7 days)));
    }

    function test_quoteMatchesReferenceWithSpread() public {
        uint256 id = _series(25_000, 7 days);
        // 10,000 MON of protection at $0.025 for a week, vol 90%: fair ~ 1.0867 AUSD, +10% spread
        uint256 q = vault.quote(id, 10_000e18);
        assertApproxEqAbs(q, 1_195_365, 2_000);
    }

    function test_minPremiumFloor() public {
        uint256 id = _series(10_000, 2 hours); // far out of the money, fair ~ 0
        uint256 q = vault.quote(id, 10_000e18);
        assertEq(q, 100_000); // 0.1% of 10,000 * $0.01 = $0.10
    }

    function test_buyLocksFullCollateral() public {
        uint256 id = _series(25_000, 7 days);
        uint256 before = ausd.balanceOf(buyer);
        vm.prank(buyer);
        uint256 premium = vault.buy(id, 10_000e18, 5e6, buyer);
        assertEq(ausd.balanceOf(buyer), before - premium);
        assertEq(vault.getSeries(id).locked, 250e6); // 10,000 * $0.025
        assertEq(vault.totalLocked(), 250e6);
        assertEq(vault.getSeries(id).token.balanceOf(buyer), 10_000e18);
    }

    function test_buyRevertsAbovePremiumLimit() public {
        uint256 id = _series(25_000, 7 days);
        vm.prank(buyer);
        vm.expectRevert();
        vault.buy(id, 10_000e18, 1, buyer);
    }

    function test_buyRevertsWithoutFreeCollateral() public {
        uint256 id = _series(30_000, 7 days); // at the money: small premium, large collateral
        // 400,000 MON needs 12,000 AUSD locked; the vault holds 10,000 plus a ~660 premium
        vm.prank(buyer);
        vm.expectRevert();
        vault.buy(id, 400_000e18, type(uint256).max, buyer);
    }

    function test_buyRevertsOnStalePrice() public {
        uint256 id = _series(25_000, 7 days);
        vm.warp(block.timestamp + 2 minutes);
        vm.prank(buyer);
        vm.expectRevert();
        vault.buy(id, 1e18, type(uint256).max, buyer);
    }

    function test_fullCycleInTheMoney() public {
        uint256 id = _series(25_000, 1 hours);
        vm.prank(buyer);
        uint256 premium = vault.buy(id, 10_000e18, 5e6, buyer);

        vm.warp(block.timestamp + 1 hours);
        px.set(MON, 15_000); // crashed to $0.015
        vault.settle(id);
        FloorVault.Series memory s = vault.getSeries(id);
        assertEq(s.payoutPerToken, 10_000); // $0.010 per MON
        assertEq(s.owed, 100e6);
        assertEq(vault.totalLocked(), 0);

        uint256 before = ausd.balanceOf(buyer);
        vm.prank(buyer);
        uint256 paid = vault.redeem(id, 10_000e18, buyer);
        assertEq(paid, 100e6);
        assertEq(ausd.balanceOf(buyer), before + 100e6);
        assertEq(vault.totalOwed(), 0);
        // depositors: 10,000 + premium - 100 payout
        assertEq(vault.totalAssets(), 10_000e6 + premium - 100e6);
    }

    function test_fullCycleOutOfTheMoney() public {
        uint256 id = _series(25_000, 1 hours);
        vm.prank(buyer);
        uint256 premium = vault.buy(id, 10_000e18, 5e6, buyer);
        vm.warp(block.timestamp + 1 hours);
        px.set(MON, 40_000);
        vault.settle(id);
        assertEq(vault.getSeries(id).owed, 0);
        assertEq(vault.totalAssets(), 10_000e6 + premium);
        vm.prank(buyer);
        assertEq(vault.redeem(id, 10_000e18, buyer), 0);
    }

    function test_settleRejectsEarlyAndStalePrice() public {
        uint256 id = _series(25_000, 1 hours);
        vm.expectRevert(FloorVault.NotExpired.selector);
        vault.settle(id);
        vm.warp(block.timestamp + 1 hours);
        // price last updated before expiry
        vm.expectRevert();
        vault.settle(id);
    }

    function test_withdrawLimitedToFreeAssets() public {
        uint256 id = _series(25_000, 7 days);
        vm.prank(buyer);
        vault.buy(id, 100_000e18, 50e6, buyer); // locks 2,500 AUSD
        uint256 free = vault.freeAssets();
        assertEq(vault.maxWithdraw(lp), free);
        vm.prank(lp);
        vm.expectRevert();
        vault.withdraw(free + 1, lp, lp);
    }

    function test_keeperOnlyCreatesSeries() public {
        vm.prank(buyer);
        vm.expectRevert(FloorVault.NotKeeper.selector);
        vault.createSeries(MON, 25_000, uint64(block.timestamp + 1 days));
    }

    function test_volBounds() public {
        vm.prank(keeper);
        vm.expectRevert();
        vol.update(MON, 0.01e18, "bad");
    }

    function test_partialRedeemsPayEveryone() public {
        uint256 id = _series(25_000, 1 hours);
        address b2 = makeAddr("b2");
        ausd.mint(b2, 100e6);
        vm.prank(b2);
        ausd.approve(address(vault), type(uint256).max);
        vm.prank(buyer);
        vault.buy(id, 3_333e18, 5e6, buyer);
        vm.prank(b2);
        vault.buy(id, 6_667e18, 5e6, b2);

        vm.warp(block.timestamp + 1 hours);
        px.set(MON, 12_345);
        vault.settle(id);
        vm.prank(buyer);
        vault.redeem(id, 3_333e18, buyer);
        vm.prank(b2);
        vault.redeem(id, 6_667e18, b2);
        assertEq(vault.getSeries(id).owed, 0);
        assertEq(vault.totalOwed(), 0);
    }
}
