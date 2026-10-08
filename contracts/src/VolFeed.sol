// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Annualised volatility per market.
/// `vols` is the pricing input, written by an authorised updater (the keeper). Each update is bounded
/// in absolute terms and may move at most `maxStepBps` from the previous value, so one bad input
/// cannot price protection near zero.
/// `observed` is written by observers (the Chainlink CRE workflow) and is never read for pricing:
/// it is the independently computed number shown next to the pricing input as a cross-check.
contract VolFeed is Ownable {
    struct Vol {
        uint128 vol; // 18 decimals, 1e18 = 100% a year
        uint64 updatedAt;
    }

    uint256 public constant MIN_VOL = 0.1e18; // 10%
    uint256 public constant MAX_VOL = 5e18; // 500%

    mapping(address => bool) public isUpdater;
    mapping(address => bool) public isObserver;
    mapping(uint256 => Vol) public vols;
    mapping(uint256 => Vol) public observed;
    uint256 public maxStepBps = 5_000; // one update moves vol by at most 50% of its previous value

    event UpdaterSet(address indexed updater, bool allowed);
    event ObserverSet(address indexed observer, bool allowed);
    event MaxStepSet(uint256 bps);
    event VolUpdated(uint256 indexed marketId, uint256 vol, uint256 updatedAt, bytes32 source);
    event VolObserved(uint256 indexed marketId, uint256 vol, uint256 updatedAt, bytes32 source);

    error NotUpdater();
    error NotObserver();
    error VolOutOfBounds(uint256 vol);
    error VolStepTooLarge(uint256 previous, uint256 vol);

    constructor(address owner_) Ownable(owner_) {}

    function setUpdater(address updater, bool allowed) external onlyOwner {
        isUpdater[updater] = allowed;
        emit UpdaterSet(updater, allowed);
    }

    function setObserver(address observer, bool allowed) external onlyOwner {
        isObserver[observer] = allowed;
        emit ObserverSet(observer, allowed);
    }

    function setMaxStepBps(uint256 bps) external onlyOwner {
        require(bps >= 500 && bps <= 50_000, "bounds");
        maxStepBps = bps;
        emit MaxStepSet(bps);
    }

    /// @notice Record an independently computed vol. Not used for pricing.
    function observe(uint256 marketId, uint256 vol, bytes32 source) external {
        if (!isObserver[msg.sender]) revert NotObserver();
        if (vol < MIN_VOL || vol > MAX_VOL) revert VolOutOfBounds(vol);
        observed[marketId] = Vol(uint128(vol), uint64(block.timestamp));
        emit VolObserved(marketId, vol, block.timestamp, source);
    }

    /// @param source short tag for where the number came from, e.g. "deribit-dvol" or "perpl-rv-7d"
    function update(uint256 marketId, uint256 vol, bytes32 source) external {
        if (!isUpdater[msg.sender]) revert NotUpdater();
        _update(marketId, vol, source);
    }

    function _update(uint256 marketId, uint256 vol, bytes32 source) internal {
        if (vol < MIN_VOL || vol > MAX_VOL) revert VolOutOfBounds(vol);
        uint256 prev = vols[marketId].vol;
        if (prev != 0) {
            uint256 step = prev * maxStepBps / 10_000;
            if (vol + step < prev || vol > prev + step) revert VolStepTooLarge(prev, vol);
        }
        vols[marketId] = Vol(uint128(vol), uint64(block.timestamp));
        emit VolUpdated(marketId, vol, block.timestamp, source);
    }

    function get(uint256 marketId) external view returns (uint256 vol, uint256 updatedAt) {
        Vol memory v = vols[marketId];
        return (v.vol, v.updatedAt);
    }

    function getObserved(uint256 marketId) external view returns (uint256 vol, uint256 updatedAt) {
        Vol memory v = observed[marketId];
        return (v.vol, v.updatedAt);
    }
}
