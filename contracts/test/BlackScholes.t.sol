// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "forge-std/Test.sol";
import {BlackScholes} from "../src/libraries/BlackScholes.sol";

/// Reference values computed with Python math.erf (exact normal CDF), see docs/spikes.
contract BlackScholesTest is Test {
    function _check(uint256 s, uint256 k, uint256 t, uint256 v, uint256 expected, uint256 relTolBps) internal pure {
        uint256 got = BlackScholes.put(s, k, t, v);
        uint256 tol = expected * relTolBps / 10_000 + 1e9; // relative + tiny absolute floor
        assertApproxEqAbs(got, expected, tol);
    }

    function test_otmPutWeekMon() public pure {
        _check(0.03e18, 0.025e18, 7 days, 0.9e18, 108669560278317, 10);
    }

    function test_atmPutWeekMon() public pure {
        _check(0.03e18, 0.03e18, 7 days, 0.9e18, 1490717634378005, 10);
    }

    function test_otmPutMonthBtc() public pure {
        _check(100_000e18, 90_000e18, 30 days, 0.5e18, 1827693354323750000000, 10);
    }

    function test_deepItmEqualsIntrinsic() public pure {
        _check(2000e18, 2500e18, 1 hours, 0.6e18, 500e18, 10);
    }

    function test_atmYear() public pure {
        _check(1e18, 1e18, 365 days, 1e18, 382924922548026240, 10);
    }

    function test_expiredIsIntrinsic() public pure {
        assertEq(BlackScholes.put(1e18, 2e18, 0, 1e18), 1e18);
        assertEq(BlackScholes.put(2e18, 1e18, 0, 1e18), 0);
    }

    function testFuzz_boundedByIntrinsicAndStrike(uint256 s, uint256 k, uint256 t, uint256 v) public pure {
        s = bound(s, 1e12, 1e24);
        k = bound(k, 1e12, 1e24);
        t = bound(t, 1, 365 days);
        v = bound(v, 0.1e18, 5e18);
        uint256 p = BlackScholes.put(s, k, t, v);
        uint256 intrinsic = k > s ? k - s : 0;
        assertGe(p, intrinsic);
        assertLe(p, k);
    }
}
