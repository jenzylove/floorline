// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SD59x18, sd, ZERO, UNIT} from "@prb/math/src/SD59x18.sol";

/// @notice Black-Scholes price of a European put with zero rates, in 18-decimal fixed point.
/// @dev Normal CDF uses Abramowitz & Stegun 26.2.17 (absolute error < 7.5e-8).
library BlackScholes {
    int256 internal constant SECONDS_PER_YEAR = 365 days;

    // A&S 26.2.17 coefficients, 18 decimals.
    int256 private constant P = 231641900000000000; // 0.2316419
    int256 private constant B1 = 319381530000000000; // 0.319381530
    int256 private constant B2 = -356563782000000000; // -0.356563782
    int256 private constant B3 = 1781477937000000000; // 1.781477937
    int256 private constant B4 = -1821255978000000000; // -1.821255978
    int256 private constant B5 = 1330274429000000000; // 1.330274429
    int256 private constant INV_SQRT_2PI = 398942280401432678; // 1/sqrt(2*pi)

    /// @param spot underlying price, 18 decimals
    /// @param strike strike price, 18 decimals
    /// @param secondsToExpiry time left in seconds
    /// @param vol annualised volatility, 18 decimals (1e18 = 100%)
    /// @return put price per unit of underlying, 18 decimals
    function put(uint256 spot, uint256 strike, uint256 secondsToExpiry, uint256 vol)
        internal
        pure
        returns (uint256)
    {
        uint256 intrinsic = strike > spot ? strike - spot : 0;
        if (secondsToExpiry == 0 || vol == 0 || spot == 0) return intrinsic;

        SD59x18 s = sd(int256(spot));
        SD59x18 k = sd(int256(strike));
        SD59x18 t = sd(int256(secondsToExpiry) * 1e18 / SECONDS_PER_YEAR);
        SD59x18 v = sd(int256(vol));

        SD59x18 volSqrtT = v.mul(t.sqrt());
        if (volSqrtT.unwrap() == 0) return intrinsic;

        SD59x18 d1 = s.div(k).ln().add(v.mul(v).mul(t).div(sd(2e18))).div(volSqrtT);
        SD59x18 d2 = d1.sub(volSqrtT);

        // put = K * N(-d2) - S * N(-d1)
        SD59x18 price = k.mul(cdf(d2.mul(sd(-1e18)))).sub(s.mul(cdf(d1.mul(sd(-1e18)))));
        int256 p = price.unwrap();
        if (p < int256(intrinsic)) return intrinsic; // numerical floor: a put is never worth less than intrinsic with r = 0
        if (p > int256(strike)) return strike; // and never more than the strike
        return uint256(p);
    }

    /// @notice Standard normal cumulative distribution function.
    function cdf(SD59x18 x) internal pure returns (SD59x18) {
        if (x.lt(ZERO)) return UNIT.sub(cdf(x.mul(sd(-1e18))));
        if (x.gt(sd(10e18))) return UNIT;
        SD59x18 t = UNIT.div(UNIT.add(sd(P).mul(x)));
        // Horner form of b1 t + b2 t^2 + b3 t^3 + b4 t^4 + b5 t^5
        SD59x18 poly = sd(B5).mul(t);
        poly = sd(B4).add(poly).mul(t);
        poly = sd(B3).add(poly).mul(t);
        poly = sd(B2).add(poly).mul(t);
        poly = sd(B1).add(poly).mul(t);
        SD59x18 pdf = sd(INV_SQRT_2PI).mul(x.mul(x).div(sd(-2e18)).exp());
        return UNIT.sub(pdf.mul(poly));
    }
}
