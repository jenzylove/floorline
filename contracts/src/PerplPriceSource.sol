// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPerpl} from "./interfaces/IPerpl.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";

/// @notice Reads Perpl's on-chain oracle price (Chainlink-sourced) and returns it in AUSD 6 decimals.
contract PerplPriceSource is IPriceSource {
    IPerpl public immutable perpl;

    error NoPrice(uint256 marketId);

    constructor(IPerpl perpl_) {
        perpl = perpl_;
    }

    function price(uint256 marketId) external view returns (uint256 price6, uint256 updatedAt) {
        IPerpl.PerpetualInfo memory info = perpl.getPerpetualInfo(marketId);
        if (info.oraclePNS == 0) revert NoPrice(marketId);
        price6 = _to6(info.oraclePNS, info.priceDecimals);
        updatedAt = info.oracleTimestampSec;
    }

    /// @notice Perpl's mark price for the market, from its order book, in AUSD 6 decimals.
    function mark(uint256 marketId) external view returns (uint256 mark6, uint256 updatedAt) {
        IPerpl.PerpetualInfo memory info = perpl.getPerpetualInfo(marketId);
        if (info.markPNS == 0) revert NoPrice(marketId);
        mark6 = _to6(info.markPNS, info.priceDecimals);
        updatedAt = info.markTimestamp;
    }

    function _to6(uint256 v, uint256 d) internal pure returns (uint256) {
        return d >= 6 ? v / 10 ** (d - 6) : v * 10 ** (6 - d);
    }
}
