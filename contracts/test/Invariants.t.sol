// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {FloorVault} from "../src/FloorVault.sol";
import {VolFeed} from "../src/VolFeed.sol";
import {MockAUSD, MockPriceSource} from "./mocks/Mocks.sol";

/// Random sequences of deposits, withdrawals, buys, price moves, time, settlements and redemptions.
contract Handler is Test {
    uint256 constant MON = 10;
    FloorVault public vault;
    MockAUSD public ausd;
    MockPriceSource public px;
    VolFeed public vol;
    address public keeper;
    address[] public actors;

    constructor(FloorVault v, MockAUSD a, MockPriceSource p, VolFeed f, address k) {
        vault = v;
        ausd = a;
        px = p;
        vol = f;
        keeper = k;
        for (uint256 i; i < 4; ++i) {
            address actor = address(uint160(0xA000 + i));
            actors.push(actor);
            ausd.mint(actor, 1_000_000e6);
            vm.prank(actor);
            ausd.approve(address(v), type(uint256).max);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _refresh() internal {
        (uint256 p,) = px.price(MON);
        px.set(MON, p);
        vm.prank(keeper);
        vol.update(MON, 0.9e18, "h");
    }

    function deposit(uint256 seed, uint256 amt) external {
        amt = bound(amt, 1e6, 50_000e6);
        address a = _actor(seed);
        _refresh();
        vm.prank(a);
        vault.deposit(amt, a);
    }

    function withdraw(uint256 seed, uint256 amt) external {
        address a = _actor(seed);
        _refresh();
        uint256 max = vault.maxWithdraw(a);
        if (max == 0) return;
        amt = bound(amt, 1, max);
        vm.prank(a);
        vault.withdraw(amt, a, a);
    }

    function create(uint256 strike, uint256 ttl) external {
        strike = bound(strike, 5_000, 60_000);
        ttl = bound(ttl, 5 minutes, 14 days);
        if (vault.activeSeriesIds().length >= 16) return;
        vm.prank(keeper);
        vault.createSeries(MON, strike, uint64(block.timestamp + ttl));
    }

    function buy(uint256 seed, uint256 sid, uint256 amt) external {
        uint256 n = vault.seriesCount();
        if (n == 0) return;
        sid = bound(sid, 0, n - 1);
        amt = bound(amt, 1e15, 2_000_000e18);
        _refresh();
        address a = _actor(seed);
        vm.prank(a);
        try vault.buy(sid, amt, type(uint256).max, a) {} catch {}
    }

    function movePrice(uint256 p) external {
        p = bound(p, 1_000, 100_000);
        px.set(MON, p);
    }

    function wait(uint256 dt) external {
        dt = bound(dt, 1, 3 days);
        vm.warp(block.timestamp + dt);
    }

    function settle(uint256 sid) external {
        uint256 n = vault.seriesCount();
        if (n == 0) return;
        sid = bound(sid, 0, n - 1);
        _refresh();
        try vault.settle(sid) {} catch {}
    }

    function redeem(uint256 seed, uint256 sid, uint256 amt) external {
        uint256 n = vault.seriesCount();
        if (n == 0) return;
        sid = bound(sid, 0, n - 1);
        FloorVault.Series memory s = vault.getSeries(sid);
        if (!s.settled) return;
        address a = _actor(seed);
        uint256 bal = s.token.balanceOf(a);
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        vm.prank(a);
        vault.redeem(sid, amt, a);
    }
}

contract InvariantsTest is Test {
    FloorVault vault;
    MockAUSD ausd;
    Handler handler;

    function setUp() public {
        vm.warp(1_790_000_000);
        ausd = new MockAUSD();
        MockPriceSource px = new MockPriceSource();
        address owner = address(this);
        address keeper = address(0xBEEF);
        VolFeed vol = new VolFeed(owner);
        vault = new FloorVault(ausd, px, vol, owner);
        vol.setUpdater(keeper, true);
        vault.setKeeper(keeper);
        vault.setMarket(10, true, "MON");
        px.set(10, 30_000);
        handler = new Handler(vault, ausd, px, vol, keeper);
        targetContract(address(handler));
    }

    /// Every token in circulation is backed: the vault always holds what it has locked and owes.
    function invariant_fullyBacked() public view {
        assertGe(ausd.balanceOf(address(vault)), vault.totalLocked() + vault.totalOwed());
    }

    /// Per series: locked collateral covers strike x supply before settlement, owed covers payout x supply after.
    function invariant_perSeriesBacking() public view {
        uint256 n = vault.seriesCount();
        uint256 lockedSum;
        uint256 owedSum;
        for (uint256 i; i < n; ++i) {
            FloorVault.Series memory s = vault.getSeries(i);
            uint256 supply = s.token.totalSupply();
            if (!s.settled) {
                assertGe(s.locked, s.strike * supply / 1e18);
                lockedSum += s.locked;
            } else {
                assertGe(s.owed, s.payoutPerToken * supply / 1e18);
                owedSum += s.owed;
            }
        }
        assertEq(lockedSum, vault.totalLocked());
        assertEq(owedSum, vault.totalOwed());
    }
}
