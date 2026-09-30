// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Spot price of an underlying market, quoted in AUSD with 6 decimals per 1 whole unit.
interface IPriceSource {
    function price(uint256 marketId) external view returns (uint256 price6, uint256 updatedAt);
}
