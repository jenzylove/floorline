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
        uint256 d = info.priceDecimals;
        price6 = d >= 6 ? info.oraclePNS / 10 ** (d - 6) : info.oraclePNS * 10 ** (6 - d);
        updatedAt = info.oracleTimestampSec;
    }
}
