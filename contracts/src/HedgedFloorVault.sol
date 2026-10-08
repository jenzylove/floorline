// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {FloorVault} from "./FloorVault.sol";
import {VolFeed} from "./VolFeed.sol";
import {IPerpl} from "./interfaces/IPerpl.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";

/// @title HedgedFloorVault
/// @notice FloorVault that owns a Perpl account and shorts the underlying to offset the protection
/// it has sold. The keeper can only open or close shorts on enabled markets, within a per-market
/// cap, and can only move money between the vault and its own Perpl account.
/// @dev Hedge money only ever comes from free assets, so locked collateral and owed payouts stay
/// in the vault. Perpl sends withdrawals back to its account owner, which is this contract.
contract HedgedFloorVault is FloorVault {
    using SafeERC20 for IERC20;

    uint8 internal constant OPEN_SHORT = 1;
    uint8 internal constant CLOSE_SHORT = 3;

    IPerpl public immutable perpl;
    uint256 public perplAccountId;
    uint256 public maxNegPnlCollatBps = 300; // Perpl market default; 0 makes taker orders fail
    uint256 public maxHedgeSlippageBps = 200; // a hedge order may not be worse than 2% from Perpl's oracle
    mapping(uint256 => uint256) public maxHedgeLots; // per market, in Perpl lot units
    uint256[] public hedgedMarkets;
    mapping(uint256 => bool) internal _isHedged;

    event HedgeAccountOpened(uint256 accountId, uint256 amount);
    event HedgeFunded(uint256 amount);
    event HedgeDefunded(uint256 amount);
    event Hedged(uint256 indexed marketId, bool open, uint256 lots, uint256 limitPrice);
    event MaxHedgeLotsSet(uint256 indexed marketId, uint256 lots);

    error NoHedgeAccount();
    error HedgeAccountExists();
    error HedgeCapExceeded(uint256 wanted, uint256 cap);
    error HedgePriceOutOfBand(uint256 limitPrice, uint256 oracle);

    constructor(IERC20 ausd, IPriceSource priceSource_, VolFeed volFeed_, IPerpl perpl_, address owner_)
        FloorVault(ausd, priceSource_, volFeed_, owner_)
    {
        perpl = perpl_;
    }

    function setMaxHedgeLots(uint256 marketId, uint256 lots) external onlyOwner {
        maxHedgeLots[marketId] = lots;
        if (!_isHedged[marketId]) {
            _isHedged[marketId] = true;
            hedgedMarkets.push(marketId);
        }
        emit MaxHedgeLotsSet(marketId, lots);
    }

    function setMaxNegPnlCollatBps(uint256 bps) external onlyOwner {
        require(bps <= 2_000, "bounds");
        maxNegPnlCollatBps = bps;
    }

    function setMaxHedgeSlippageBps(uint256 bps) external onlyOwner {
        require(bps >= 10 && bps <= 1_000, "bounds");
        maxHedgeSlippageBps = bps;
    }

    /// @notice Open the vault's Perpl account with `amount` AUSD from free assets.
    function openHedgeAccount(uint256 amount) external onlyKeeperOrOwner nonReentrant {
        if (perplAccountId != 0) revert HedgeAccountExists();
        _requireFree(amount);
        IERC20(asset()).forceApprove(address(perpl), amount);
        perplAccountId = perpl.createAccount(amount);
        emit HedgeAccountOpened(perplAccountId, amount);
    }

    function fundHedge(uint256 amount) external onlyKeeperOrOwner nonReentrant {
        if (perplAccountId == 0) revert NoHedgeAccount();
        _requireFree(amount);
        IERC20(asset()).forceApprove(address(perpl), amount);
        perpl.depositCollateral(amount);
        emit HedgeFunded(amount);
    }

    function defundHedge(uint256 amount) external onlyKeeperOrOwner nonReentrant {
        if (perplAccountId == 0) revert NoHedgeAccount();
        perpl.withdrawCollateral(amount); // Perpl pays the account owner: this vault
        emit HedgeDefunded(amount);
    }

    /// @notice Open (sell) or close (buy back) a short on Perpl. Immediate-or-cancel with a price bound.
    /// @param limitPrice worst acceptable price in Perpl's price units: minimum for opening, maximum for closing
    function hedge(uint256 marketId, bool open, uint256 lots, uint256 limitPrice)
        external
        onlyKeeperOrOwner
        nonReentrant
    {
        if (perplAccountId == 0) revert NoHedgeAccount();
        if (!markets[marketId].enabled) revert MarketDisabled();
        if (open) {
            uint256 wanted = shortLots(marketId) + lots;
            if (wanted > maxHedgeLots[marketId]) revert HedgeCapExceeded(wanted, maxHedgeLots[marketId]);
        }
        // The keeper picks the limit, so bound it to Perpl's own oracle: selling (open) no lower than
        // oracle - band, buying back (close) no higher than oracle + band. A keeper cannot move value
        // out by trading against its own resting orders at a bad price.
        IPerpl.PerpetualInfo memory info = perpl.getPerpetualInfo(marketId);
        uint256 oracle = info.oraclePNS;
        if (oracle == 0 || block.timestamp > info.oracleTimestampSec + maxPriceAge) revert StalePrice(info.oracleTimestampSec);
        uint256 band = oracle * maxHedgeSlippageBps / 10_000;
        if (open ? limitPrice < oracle - band : limitPrice > oracle + band) revert HedgePriceOutOfBand(limitPrice, oracle);
        perpl.execOrder(
            IPerpl.OrderDesc({
                orderDescId: block.number,
                perpId: marketId,
                orderType: open ? OPEN_SHORT : CLOSE_SHORT,
                orderId: 0,
                pricePNS: limitPrice,
                lotLNS: lots,
                expiryBlock: 0,
                postOnly: false,
                fillOrKill: false,
                immediateOrCancel: true,
                maxMatches: 0,
                leverageHdths: 100, // 1x: the short is fully funded, it cannot be liquidated by a 100% move
                lastExecutionBlock: block.number + 20,
                amountCNS: 0,
                maxNegPnlCollatBPS: maxNegPnlCollatBps
            })
        );
        emit Hedged(marketId, open, lots, limitPrice);
    }

    /// @notice Current short size on a market, in Perpl lots.
    function shortLots(uint256 marketId) public view returns (uint256) {
        if (perplAccountId == 0) return 0;
        (IPerpl.PositionInfo memory p,,) = perpl.getPosition(marketId, perplAccountId);
        return p.positionType == 1 ? p.lotLNS : 0;
    }

    /// @notice Money in the Perpl account: free balance plus each position's deposit and profit or loss.
    function hedgeEquity() public view override returns (uint256) {
        if (perplAccountId == 0) return 0;
        int256 equity = int256(_perplFreeBalance());
        uint256 n = hedgedMarkets.length;
        for (uint256 i; i < n; ++i) {
            (IPerpl.PositionInfo memory p,,) = perpl.getPosition(hedgedMarkets[i], perplAccountId);
            if (p.lotLNS == 0) continue;
            equity += int256(p.depositCNS) + p.pnlCNS;
        }
        return equity > 0 ? uint256(equity) : 0;
    }

    function _perplFreeBalance() internal view returns (uint256) {
        IPerpl.AccountInfo memory a = perpl.getAccountById(perplAccountId);
        return a.balanceCNS + a.lockedBalanceCNS;
    }

    function _requireFree(uint256 amount) internal view {
        uint256 free = freeAssets();
        if (amount > free) revert NotEnoughFreeCollateral(amount, free);
    }
}
