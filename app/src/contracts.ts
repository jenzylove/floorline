import { parseAbi } from "viem";

/** Monad mainnet (chain 143). v2, deployed 8 Oct 2026 after the audit. */
export const ADDR = {
  vault: "0x2286f16a97e592D2C90C31e3ae56E3F4A9ec5dB4",
  volFeed: "0x1820045B9a1366d7a8aB8715cf9607f0C3635c6d",
  priceSource: "0x0E21C63a335344Db44938C02170374302e7b0b77",
  perpl: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
  ausd: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
} as const;

export const MON_MARKET = 10;
export const PERPL_API = "https://app.perpl.xyz/api";

export const vaultAbi = parseAbi([
  "function quote(uint256 seriesId, uint256 amount) view returns (uint256)",
  "function buy(uint256 seriesId, uint256 amount, uint256 maxPremium, address receiver) returns (uint256)",
  "function redeem(uint256 seriesId, uint256 amount, address receiver) returns (uint256)",
  "function seriesCount() view returns (uint256)",
  "function activeSeriesIds() view returns (uint256[])",
  "function getSeries(uint256) view returns ((uint256 marketId, uint256 strike, uint64 expiry, bool settled, address token, uint256 locked, uint256 payoutPerToken, uint256 settlePrice, uint256 owed))",
  "function isShortTenor(uint256) view returns (bool)",
  "function isDemoBuyer(address) view returns (bool)",
  "function buysPaused() view returns (bool)",
  "function totalAssets() view returns (uint256)",
  "function totalLocked() view returns (uint256)",
  "function totalOwed() view returns (uint256)",
  "function freeAssets() view returns (uint256)",
  "function openLiability() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function valuationFresh() view returns (bool)",
  "event Bought(uint256 indexed seriesId, address indexed buyer, address indexed receiver, uint256 amount, uint256 premium, uint256 collateral)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const priceAbi = parseAbi([
  "function price(uint256) view returns (uint256 price6, uint256 updatedAt)",
  "function mark(uint256) view returns (uint256 mark6, uint256 updatedAt)",
]);

export const volAbi = parseAbi(["function get(uint256) view returns (uint256 vol, uint256 updatedAt)", "function getObserved(uint256) view returns (uint256 vol, uint256 updatedAt)"]);

/** The subset of Perpl's Exchange used by the Trade tab (field order from PerplFoundation/dex-sdk). */
export const perplAbi = [
  {
    type: "function",
    name: "getAccountByAddr",
    stateMutability: "view",
    inputs: [{ name: "accountAddress", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "accountId", type: "uint256" },
          { name: "balanceCNS", type: "uint256" },
          { name: "lockedBalanceCNS", type: "uint256" },
          { name: "frozen", type: "uint8" },
          { name: "accountAddr", type: "address" },
          {
            name: "positions",
            type: "tuple",
            components: [
              { name: "bank1", type: "uint256" },
              { name: "bank2", type: "uint256" },
              { name: "bank3", type: "uint256" },
              { name: "bank4", type: "uint256" },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getPosition",
    stateMutability: "view",
    inputs: [
      { name: "perpId", type: "uint256" },
      { name: "accountId", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "accountId", type: "uint256" },
          { name: "nextNodeId", type: "uint256" },
          { name: "prevNodeId", type: "uint256" },
          { name: "positionType", type: "uint8" },
          { name: "depositCNS", type: "uint256" },
          { name: "pricePNS", type: "uint256" },
          { name: "lotLNS", type: "uint256" },
          { name: "entryBlock", type: "uint256" },
          { name: "pnlCNS", type: "int256" },
          { name: "deltaPnlCNS", type: "int256" },
          { name: "premiumPnlCNS", type: "int256" },
        ],
      },
      { type: "uint256" },
      { type: "bool" },
    ],
  },
  { type: "function", name: "getMinAccountOpenCNS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "createAccount", stateMutability: "nonpayable", inputs: [{ name: "amountCNS", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "depositCollateral", stateMutability: "nonpayable", inputs: [{ name: "amountCNS", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawCollateral", stateMutability: "nonpayable", inputs: [{ name: "amountCNS", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "execOrder",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "orderDesc",
        type: "tuple",
        components: [
          { name: "orderDescId", type: "uint256" },
          { name: "perpId", type: "uint256" },
          { name: "orderType", type: "uint8" },
          { name: "orderId", type: "uint256" },
          { name: "pricePNS", type: "uint256" },
          { name: "lotLNS", type: "uint256" },
          { name: "expiryBlock", type: "uint256" },
          { name: "postOnly", type: "bool" },
          { name: "fillOrKill", type: "bool" },
          { name: "immediateOrCancel", type: "bool" },
          { name: "maxMatches", type: "uint256" },
          { name: "leverageHdths", type: "uint256" },
          { name: "lastExecutionBlock", type: "uint256" },
          { name: "amountCNS", type: "uint256" },
          { name: "maxNegPnlCollatBPS", type: "uint256" },
        ],
      },
    ],
    outputs: [{ type: "bytes" }],
  },
] as const;

/** Perpl order types (Exchange.execOrder). */
export const ORDER = { openLong: 0, openShort: 1, closeLong: 2, closeShort: 3 } as const;
