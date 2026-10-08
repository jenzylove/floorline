// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Spot price of an underlying market, quoted in AUSD with 6 decimals per 1 whole unit.
interface IPriceSource {
    /// @notice Oracle price used for pricing and settlement.
    function price(uint256 marketId) external view returns (uint256 price6, uint256 updatedAt);

    /// @notice An independent live price (the exchange's mark) used to reject buys while the oracle lags.
    function mark(uint256 marketId) external view returns (uint256 mark6, uint256 updatedAt);
}
