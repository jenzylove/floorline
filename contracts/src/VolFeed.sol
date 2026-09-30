// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Annualised volatility per market, written by an authorised updater (the CRE workflow
/// or its fallback keeper). Values are bounded so a bad input cannot price protection at zero.
contract VolFeed is Ownable {
    struct Vol {
        uint128 vol; // 18 decimals, 1e18 = 100% a year
        uint64 updatedAt;
    }

    uint256 public constant MIN_VOL = 0.1e18; // 10%
    uint256 public constant MAX_VOL = 5e18; // 500%

    mapping(address => bool) public isUpdater;
    mapping(uint256 => Vol) public vols;

    event UpdaterSet(address indexed updater, bool allowed);
    event VolUpdated(uint256 indexed marketId, uint256 vol, uint256 updatedAt, bytes32 source);

    error NotUpdater();
    error VolOutOfBounds(uint256 vol);

    constructor(address owner_) Ownable(owner_) {}

    function setUpdater(address updater, bool allowed) external onlyOwner {
        isUpdater[updater] = allowed;
        emit UpdaterSet(updater, allowed);
    }

    /// @param source short tag for where the number came from, e.g. "deribit-dvol" or "perpl-rv-7d"
    function update(uint256 marketId, uint256 vol, bytes32 source) external {
        if (!isUpdater[msg.sender]) revert NotUpdater();
        _update(marketId, vol, source);
    }

    function _update(uint256 marketId, uint256 vol, bytes32 source) internal {
        if (vol < MIN_VOL || vol > MAX_VOL) revert VolOutOfBounds(vol);
        vols[marketId] = Vol(uint128(vol), uint64(block.timestamp));
        emit VolUpdated(marketId, vol, block.timestamp, source);
    }

    function get(uint256 marketId) external view returns (uint256 vol, uint256 updatedAt) {
        Vol memory v = vols[marketId];
        return (v.vol, v.updatedAt);
    }
}
