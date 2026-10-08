// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {ProtectionToken} from "./ProtectionToken.sol";
import {VolFeed} from "./VolFeed.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";
import {BlackScholes} from "./libraries/BlackScholes.sol";

/// @title FloorVault
/// @notice Sells fully backed protection (European, cash-settled puts) on Perpl-priced markets and
/// pays it out in AUSD. Depositors provide the collateral and earn the premiums.
/// @dev Every protection token in circulation has `strike` AUSD locked behind it until settlement,
/// and settled payouts are set aside until redeemed. Depositors can only withdraw what is neither.
contract FloorVault is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    struct Series {
        uint256 marketId; // Perpl market id of the underlying
        uint256 strike; // AUSD (6 decimals) per 1 whole unit of the underlying
        uint64 expiry; // unix seconds
        bool settled;
        ProtectionToken token;
        uint256 locked; // AUSD locked behind the tokens in circulation (before settlement)
        uint256 payoutPerToken; // AUSD (6 decimals) per 1e18 tokens, set at settlement
        uint256 settlePrice; // price used at settlement, AUSD 6 decimals
        uint256 owed; // AUSD still owed to holders after settlement
    }

    struct Market {
        bool enabled;
        string symbol; // "MON", "BTC", ...
    }

    uint256 public constant MAX_ACTIVE_SERIES = 32;
    uint256 private constant WAD = 1e18;
    uint256 private constant TO_WAD = 1e12; // 6 -> 18 decimals

    IPriceSource public priceSource;
    VolFeed public volFeed;

    address public keeper;
    bool public buysPaused;

    uint256 public spreadBps = 1000; // premium = fair value * (1 + 10%)
    uint256 public minPremiumBps = 10; // at least 0.1% of the protected amount
    uint256 public maxPriceAge = 10; // seconds; Perpl's oracle lags the market, so keep this short
    uint256 public maxVolAge = 1 days;
    uint256 public minTimeToExpiry = 60; // stop selling a series in its last minute

    uint256 public settleWindow = 120; // seconds after expiry in which anyone can settle
    uint256 public maxMarkDeviationBps = 100; // reject buys when oracle and mark disagree by more than 1%
    uint256 public minPublicTenor = 1 hours; // shorter series can only be bought by allowlisted buyers
    uint256 public shortTenorSpreadBps = 2000; // extra spread on series shorter than minPublicTenor
    uint256 public constant EMERGENCY_GRACE = 1 days;

    mapping(uint256 => Market) public markets;
    Series[] internal _series;
    uint256[] public activeSeries; // unsettled series ids

    uint256 public totalLocked; // sum of `locked` over unsettled series
    uint256 public totalOwed; // sum of `owed` over settled series

    mapping(uint256 => uint64) public seriesCreatedAt;
    mapping(address => bool) public isDemoBuyer;

    event MarketSet(uint256 indexed marketId, bool enabled, string symbol);
    event SeriesCreated(uint256 indexed seriesId, uint256 indexed marketId, uint256 strike, uint64 expiry, address token);
    event Bought(uint256 indexed seriesId, address indexed buyer, address indexed receiver, uint256 amount, uint256 premium, uint256 collateral);
    event Settled(uint256 indexed seriesId, uint256 price, uint256 priceTime, uint256 payoutPerToken, uint256 owed, uint256 released);
    event Redeemed(uint256 indexed seriesId, address indexed holder, address indexed receiver, uint256 amount, uint256 paid);
    event ParamsSet(uint256 spreadBps, uint256 minPremiumBps, uint256 maxPriceAge, uint256 maxVolAge, uint256 minTimeToExpiry);
    event KeeperSet(address keeper);
    event BuysPaused(bool paused);
    event GuardsSet(uint256 settleWindow, uint256 maxMarkDeviationBps, uint256 minPublicTenor, uint256 shortTenorSpreadBps);
    event DemoBuyerSet(address indexed buyer, bool allowed);
    event SettledLate(uint256 indexed seriesId, address indexed by, bool emergency);

    error NotKeeper();
    error MarketDisabled();
    error BadSeries();
    error TooManyActiveSeries();
    error SeriesClosed();
    error NotExpired();
    error AlreadySettled();
    error NotSettled();
    error StalePrice(uint256 updatedAt);
    error StaleVol(uint256 updatedAt);
    error PriceBeforeExpiry(uint256 priceTime, uint256 expiry);
    error PremiumTooHigh(uint256 premium, uint256 maxPremium);
    error NotEnoughFreeCollateral(uint256 needed, uint256 free);
    error Paused();
    error ZeroAmount();
    error PriceDisagreement(uint256 oracle, uint256 mark);
    error RestrictedSeries();
    error SettleWindowMissed(uint256 priceTime, uint256 windowEnd);
    error TooEarlyForEmergency();
    error StaleValuation();

    modifier onlyKeeperOrOwner() {
        if (msg.sender != keeper && msg.sender != owner()) revert NotKeeper();
        _;
    }

    constructor(IERC20 ausd, IPriceSource priceSource_, VolFeed volFeed_, address owner_)
        ERC20("Floorline Vault AUSD", "flAUSD")
        ERC4626(ausd)
        Ownable(owner_)
    {
        priceSource = priceSource_;
        volFeed = volFeed_;
    }

    // ------------------------------------------------------------------ admin

    function setGuards(
        uint256 settleWindow_,
        uint256 maxMarkDeviationBps_,
        uint256 minPublicTenor_,
        uint256 shortTenorSpreadBps_
    ) external onlyOwner {
        require(
            settleWindow_ >= 30 && settleWindow_ <= 1 hours && maxMarkDeviationBps_ <= 1_000
                && shortTenorSpreadBps_ <= 10_000,
            "bounds"
        );
        settleWindow = settleWindow_;
        maxMarkDeviationBps = maxMarkDeviationBps_;
        minPublicTenor = minPublicTenor_;
        shortTenorSpreadBps = shortTenorSpreadBps_;
        emit GuardsSet(settleWindow_, maxMarkDeviationBps_, minPublicTenor_, shortTenorSpreadBps_);
    }

    function setDemoBuyer(address buyer, bool allowed) external onlyOwner {
        isDemoBuyer[buyer] = allowed;
        emit DemoBuyerSet(buyer, allowed);
    }

    function setMarket(uint256 marketId, bool enabled, string calldata symbol) external onlyOwner {
        markets[marketId] = Market(enabled, symbol);
        emit MarketSet(marketId, enabled, symbol);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setBuysPaused(bool paused) external onlyOwner {
        buysPaused = paused;
        emit BuysPaused(paused);
    }

    function setParams(
        uint256 spreadBps_,
        uint256 minPremiumBps_,
        uint256 maxPriceAge_,
        uint256 maxVolAge_,
        uint256 minTimeToExpiry_
    ) external onlyOwner {
        require(spreadBps_ <= 10_000 && minPremiumBps_ <= 1_000 && maxPriceAge_ >= 1 && maxPriceAge_ <= 300, "bounds");
        spreadBps = spreadBps_;
        minPremiumBps = minPremiumBps_;
        maxPriceAge = maxPriceAge_;
        maxVolAge = maxVolAge_;
        minTimeToExpiry = minTimeToExpiry_;
        emit ParamsSet(spreadBps_, minPremiumBps_, maxPriceAge_, maxVolAge_, minTimeToExpiry_);
    }

    /// @notice Open a new series. Anyone can buy it until one minute before expiry.
    function createSeries(uint256 marketId, uint256 strike, uint64 expiry)
        external
        onlyKeeperOrOwner
        returns (uint256 seriesId)
    {
        Market storage m = markets[marketId];
        if (!m.enabled) revert MarketDisabled();
        if (strike == 0 || expiry <= block.timestamp + minTimeToExpiry) revert BadSeries();
        if (activeSeries.length >= MAX_ACTIVE_SERIES) revert TooManyActiveSeries();

        seriesId = _series.length;
        string memory label = string.concat(m.symbol, " below ", _fmt6(strike), " @", Strings.toString(expiry));
        ProtectionToken token = new ProtectionToken(
            string.concat("Floorline ", label), string.concat("fl", m.symbol, "-P-", Strings.toString(seriesId)), seriesId
        );
        _series.push(
            Series({
                marketId: marketId,
                strike: strike,
                expiry: expiry,
                settled: false,
                token: token,
                locked: 0,
                payoutPerToken: 0,
                settlePrice: 0,
                owed: 0
            })
        );
        activeSeries.push(seriesId);
        seriesCreatedAt[seriesId] = uint64(block.timestamp);
        emit SeriesCreated(seriesId, marketId, strike, expiry, address(token));
    }

    // ------------------------------------------------------------------ protection

    /// @notice Price to buy `amount` (1e18 = 1 unit of underlying) of a series, in AUSD.
    function quote(uint256 seriesId, uint256 amount) public view returns (uint256 premium) {
        Series storage s = _get(seriesId);
        if (s.settled || block.timestamp + minTimeToExpiry >= s.expiry) revert SeriesClosed();
        uint256 spot = _checkedSpot(s.marketId);
        (uint256 vol, uint256 volAt) = volFeed.get(s.marketId);
        if (vol == 0 || block.timestamp > volAt + maxVolAge) revert StaleVol(volAt);

        uint256 perUnitWad = BlackScholes.put(spot * TO_WAD, s.strike * TO_WAD, s.expiry - block.timestamp, vol);
        uint256 fair = perUnitWad.mulDiv(amount, WAD * TO_WAD, Math.Rounding.Ceil);
        uint256 spread = isShortTenor(seriesId) ? spreadBps + shortTenorSpreadBps : spreadBps;
        premium = fair.mulDiv(10_000 + spread, 10_000, Math.Rounding.Ceil);
        uint256 floorPremium = s.strike.mulDiv(amount, WAD, Math.Rounding.Ceil).mulDiv(minPremiumBps, 10_000, Math.Rounding.Ceil);
        if (premium < floorPremium) premium = floorPremium;
    }

    /// @notice Buy protection. Pays `premium` AUSD from the caller, mints tokens to `receiver`.
    function buy(uint256 seriesId, uint256 amount, uint256 maxPremium, address receiver)
        external
        nonReentrant
        returns (uint256 premium)
    {
        if (buysPaused) revert Paused();
        if (amount == 0) revert ZeroAmount();
        if (isShortTenor(seriesId) && !isDemoBuyer[msg.sender]) revert RestrictedSeries();
        premium = quote(seriesId, amount);
        if (premium > maxPremium) revert PremiumTooHigh(premium, maxPremium);

        Series storage s = _series[seriesId];
        uint256 collateral = s.strike.mulDiv(amount, WAD, Math.Rounding.Ceil);

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), premium);
        uint256 free = freeAssets();
        if (collateral > free) revert NotEnoughFreeCollateral(collateral, free);

        s.locked += collateral;
        totalLocked += collateral;
        s.token.mint(receiver, amount);
        emit Bought(seriesId, msg.sender, receiver, amount, premium, collateral);
    }

    /// @notice Fix the settlement price of an expired series. Anyone can call it within `settleWindow`
    /// of expiry, with the oracle price at that moment. After the window only the owner can, so nobody
    /// can wait for a favourable price and settle then.
    function settle(uint256 seriesId) external nonReentrant {
        Series storage s = _get(seriesId);
        if (s.settled) revert AlreadySettled();
        if (block.timestamp < s.expiry) revert NotExpired();
        (uint256 p, uint256 t) = priceSource.price(s.marketId);
        if (t < s.expiry) revert PriceBeforeExpiry(t, s.expiry);
        uint256 windowEnd = s.expiry + settleWindow;
        if (t > windowEnd || block.timestamp > windowEnd) {
            if (msg.sender != owner()) revert SettleWindowMissed(t, windowEnd);
            emit SettledLate(seriesId, msg.sender, false);
        }
        _settle(seriesId, s, p, t);
    }

    /// @notice Last resort if the price source stops answering: the owner sets the price a day after
    /// expiry. Every use is logged on chain. The payout per token can never exceed the locked strike.
    function emergencySettle(uint256 seriesId, uint256 price6) external onlyOwner nonReentrant {
        Series storage s = _get(seriesId);
        if (s.settled) revert AlreadySettled();
        if (block.timestamp < s.expiry + EMERGENCY_GRACE) revert TooEarlyForEmergency();
        emit SettledLate(seriesId, msg.sender, true);
        _settle(seriesId, s, price6, block.timestamp);
    }

    function _settle(uint256 seriesId, Series storage s, uint256 p, uint256 t) internal {
        uint256 payout = s.strike > p ? s.strike - p : 0;
        uint256 supply = s.token.totalSupply();
        uint256 owed = payout.mulDiv(supply, WAD, Math.Rounding.Ceil);
        if (owed > s.locked) owed = s.locked; // cannot happen (payout <= strike), kept as a hard cap

        uint256 released = s.locked - owed;
        totalLocked -= s.locked;
        totalOwed += owed;
        s.locked = 0;
        s.owed = owed;
        s.payoutPerToken = payout;
        s.settlePrice = p;
        s.settled = true;
        _removeActive(seriesId);
        emit Settled(seriesId, p, t, payout, owed, released);
    }

    /// @notice Burn settled tokens and receive their payout in AUSD.
    function redeem(uint256 seriesId, uint256 amount, address receiver) external nonReentrant returns (uint256 paid) {
        Series storage s = _get(seriesId);
        if (!s.settled) revert NotSettled();
        if (amount == 0) revert ZeroAmount();
        uint256 supplyBefore = s.token.totalSupply();
        s.token.burn(msg.sender, amount);
        paid = amount == supplyBefore ? s.owed : s.payoutPerToken.mulDiv(amount, WAD, Math.Rounding.Floor);
        if (paid > s.owed) paid = s.owed;
        s.owed -= paid;
        totalOwed -= paid;
        if (paid > 0) IERC20(asset()).safeTransfer(receiver, paid);
        emit Redeemed(seriesId, msg.sender, receiver, amount, paid);
    }

    /// @notice True when a series runs for less than `minPublicTenor`: a demo series, allowlisted buyers only.
    function isShortTenor(uint256 seriesId) public view returns (bool) {
        Series storage s = _get(seriesId);
        return s.expiry - seriesCreatedAt[seriesId] < minPublicTenor;
    }

    // ------------------------------------------------------------------ accounting

    /// @notice False when any open series is valued from a stale price or vol. Deposits wait until it is
    /// fresh again, so nobody can buy shares at the low price a stale input produces.
    function valuationFresh() public view returns (bool) {
        uint256 n = activeSeries.length;
        for (uint256 i; i < n; ++i) {
            Series storage s = _series[activeSeries[i]];
            if (s.locked == 0) continue;
            (uint256 p, uint256 t) = priceSource.price(s.marketId);
            if (p == 0 || block.timestamp > t + maxPriceAge) return false;
            if (block.timestamp < s.expiry) {
                (uint256 vol, uint256 volAt) = volFeed.get(s.marketId);
                if (vol == 0 || block.timestamp > volAt + maxVolAge) return false;
            }
        }
        return true;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (!valuationFresh()) revert StaleValuation();
        super._deposit(caller, receiver, assets, shares);
    }

    /// @notice AUSD held by the vault that is neither locked behind protection nor owed to holders.
    function freeAssets() public view returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this));
        uint256 reserved = totalLocked + totalOwed;
        return bal > reserved ? bal - reserved : 0;
    }

    /// @notice What the open protection is worth today (the vault's liability), capped at what is locked.
    /// @dev Uses the current price and vol. If either is stale, counts the full locked amount.
    function openLiability() public view returns (uint256 liability) {
        uint256 n = activeSeries.length;
        for (uint256 i; i < n; ++i) {
            Series storage s = _series[activeSeries[i]];
            if (s.locked == 0) continue;
            liability += _seriesValue(s);
        }
    }

    /// @dev Depositors own everything except payouts owed and the current value of open protection.
    function totalAssets() public view override returns (uint256) {
        uint256 bal = IERC20(asset()).balanceOf(address(this)) + hedgeEquity();
        uint256 claims = totalOwed + openLiability();
        return bal > claims ? bal - claims : 0;
    }

    /// @notice Equity held outside the vault for hedging. Zero until the Perpl hedge is attached.
    function hedgeEquity() public view virtual returns (uint256) {
        return 0;
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner_), freeAssets());
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        return Math.min(super.maxRedeem(owner_), convertToShares(freeAssets()));
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    // ------------------------------------------------------------------ views

    function seriesCount() external view returns (uint256) {
        return _series.length;
    }

    function getSeries(uint256 seriesId) external view returns (Series memory) {
        return _get(seriesId);
    }

    function activeSeriesIds() external view returns (uint256[] memory) {
        return activeSeries;
    }

    // ------------------------------------------------------------------ internals

    function _get(uint256 seriesId) internal view returns (Series storage) {
        if (seriesId >= _series.length) revert BadSeries();
        return _series[seriesId];
    }

    /// @dev Oracle price, fresh, and within `maxMarkDeviationBps` of the exchange's live mark.
    function _checkedSpot(uint256 marketId) internal view returns (uint256 p) {
        uint256 t;
        (p, t) = priceSource.price(marketId);
        if (p == 0 || block.timestamp > t + maxPriceAge) revert StalePrice(t);
        (uint256 m,) = priceSource.mark(marketId);
        uint256 diff = m > p ? m - p : p - m;
        if (m == 0 || diff * 10_000 > p * maxMarkDeviationBps) revert PriceDisagreement(p, m);
    }

    function _seriesValue(Series storage s) internal view returns (uint256) {
        (uint256 p, uint256 t) = priceSource.price(s.marketId);
        if (p == 0 || block.timestamp > t + maxPriceAge) return s.locked;
        uint256 supply = s.token.totalSupply();
        uint256 perUnitWad;
        if (block.timestamp >= s.expiry) {
            perUnitWad = s.strike > p ? (s.strike - p) * TO_WAD : 0;
        } else {
            (uint256 vol, uint256 volAt) = volFeed.get(s.marketId);
            if (vol == 0 || block.timestamp > volAt + maxVolAge) return s.locked;
            perUnitWad = BlackScholes.put(p * TO_WAD, s.strike * TO_WAD, s.expiry - block.timestamp, vol);
        }
        uint256 v = perUnitWad.mulDiv(supply, WAD * TO_WAD, Math.Rounding.Ceil);
        return v > s.locked ? s.locked : v;
    }

    function _removeActive(uint256 seriesId) internal {
        uint256 n = activeSeries.length;
        for (uint256 i; i < n; ++i) {
            if (activeSeries[i] == seriesId) {
                activeSeries[i] = activeSeries[n - 1];
                activeSeries.pop();
                return;
            }
        }
    }

    /// @dev 6-decimal amount to a short decimal string, e.g. 25000 -> "0.025".
    function _fmt6(uint256 v) internal pure returns (string memory) {
        uint256 whole = v / 1e6;
        uint256 frac = v % 1e6;
        if (frac == 0) return Strings.toString(whole);
        bytes memory f = bytes(Strings.toString(frac + 1e6)); // leading "1" keeps zeros
        uint256 len = 7;
        while (len > 2 && f[len - 1] == "0") len--;
        bytes memory out = new bytes(len - 1);
        for (uint256 i = 1; i < len; ++i) out[i - 1] = f[i];
        return string.concat(Strings.toString(whole), ".", string(out));
    }
}
