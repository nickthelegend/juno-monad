# Kuru research for Juno (Monad Metropolis)

Researched 2026-09-24. Mainnet block ~107.41M, testnet block ~65.1M.

Legend: **[V]** means I checked it myself (read-only `eth_call`, `eth_getCode`, storage reads, or a live HTTP/WS call). **[D]** means it comes from Kuru or Perpl docs or source and I did not re-check it on-chain. **[U]** means unverified, second-hand or inferred.

Supporting artifacts are in `scratchpad/kuru/`: the Kuru `llms-full.txt`, OpenAPI specs, SDK ABIs, the public contract source, the `sim/` Foundry project used for the graduation simulation, and Perpl docs.

---

## TL;DR

1. **Kuru has no perps.** It has no perpetuals, leverage, funding, liquidations or oracle. The word "margin" in `MarginAccount` and `_isMargin` means "use your deposited balance instead of your wallet". It does not mean leverage.
   - Kuru is building a v2 exchange (`AccountCore` + spot v2, relay, EIP-7702 trading wallets) that is live on **testnet only**.
   - Its SDK says outright: *"Perps are intentionally not exposed in v1. The `products` module exists so future product modules can be added."* So perps are a future plan, not a product.
   - What the team most likely means by "Kuru's perps" is **Perpl**: the live on-chain CLOB perps DEX on Monad, which has its own $5k + $3k Metropolis bounties. The other reading is "Kuru spot + Perpl perps".
2. **Graduating a Juno curve into a Kuru market works on testnet and is blocked on mainnet.**
   - I simulated the whole flow on testnet with a single `eth_call`: lock → deploy market → seed the AMM vault in the same tx → trade. The market opened at exactly the curve price. **[V]**
   - On mainnet, `Router.deployProxy` and `MonadDeployer.deployTokenAndMarket` both revert `Unauthorized()` for everyone except the Router owner, a Kuru 3-of-5 Safe. **[V]**
3. **Spot integration works without the SDK.** Direct viem calls to `OrderBook` / `MarginAccount` / `KuruAMMVault` work, and the ABIs in the SDK repo match the deployed selectors. `eth_call` from `address(0)` works as a free on-chain quoter. **[V]**
   - The official TS SDK `@kuru-labs/kuru-sdk` still pins **ethers 5.7.1**.
4. **Kuru Flow (aggregator) is mainnet only.** The JWT is 1 rps per address. It supports an integrator/referrer fee (`referrerAddress`, `referrerFeeBps`). **[V]**
5. **The Kuru bounties have no public judging criteria.**
   - The official page gives only titles and $5k each.
   - A participant's copy of the consumer-app criteria: *"working focused spot product routing through Kuru onchain order book … integration strength, clear target user, evidence of demand through usage/trading activity, credible acquisition/retention and plan after hackathon."* **[U]**
   - Also relevant to Juno: **Agora "Best Mobile Trading App on Monad" ($10k)**. The user's own `xorr-metropolis/PLAN.md` notes that "Agora requires Mera authentication". **[U]**

---

## 1. Perps

### 1.1 Kuru: no perps (verified in several places)

- **Docs.** `docs.kuru.io/llms-full.txt` (151 KB, the whole doc set) has zero hits for perp, leverage, futures or funding. The product list is Wallet, Flow, Swap, Discover, Trade, Vaults, Portfolio, Referrals and Launch, all spot. **[D]** Source: https://docs.kuru.io/llms-full.txt
- **Contracts.** The public source `Kuru-Labs/Kuru-contracts-dex-public` (Router, OrderBook, MarginAccount, KuruAMMVault, KuruForwarder, MonadDeployer) has no positions, funding or liquidation. **[D]** Source: https://github.com/Kuru-Labs/Kuru-contracts-dex-public
  - `placeAndExecuteMarketBuy(..., bool _isMargin, ...)`: `_isMargin` only chooses between `marginAccount.debitUser` and `safeTransferFrom(wallet)`.
- **New v2 SDK.** `Kuru-Labs/ts-sdk`, published as `@toxicflow-labs/ts-sdk` 0.1.1 on 2026-09-17, is viem-first. **[D]**
  - `docs/architecture.md`: *"Perps are intentionally not exposed in v1. The `products` module exists so future product modules can be added without reshaping the spot API."*
  - `src/products/index.ts` only re-exports `spot`.
  - Across all of its generated ABIs (AccountCore, SpotRouter, OrderBook, SpotPeriphery), there are no functions for perp, funding, liquidation, leverage or oracle. The only match is the error `InvalidCollateral`.
  - Sources: https://github.com/Kuru-Labs/ts-sdk/blob/main/docs/architecture.md, https://www.npmjs.com/package/@toxicflow-labs/ts-sdk
- **Third-party reviews** say "Kuru only supports spot trading … no futures, perps, or leverage". **[U]** Source: https://www.cryptowisser.com/exchange/kuru/

**Conclusion:** there is no Kuru perps product, API, contract or testnet. The v2 architecture (AccountCore with subaccounts, a "products" slot) looks built to host perps later. That is inference **[U]**.

#### Kuru v2 status (context, verified)

- Testnet gateway: `https://api.testnet.kuru.io/api/v1/markets` lists 4 spot markets: CBBTCUSDC `0x5bdea6f9…`, WETHUSDC `0xa9c29366…`, MONUSDC `0xfdbe3568…`, XAUTUSDC `0x0b4dd2a7…`. The quote is "Kuru Testnet USDC" `0xee0722ea…`. **[V]**
- AccountCore `0x6384e9b2Bf3b65e1535403a0A543b5FDA905eE22`, SpotRouter `0xba24a1042701f06e8F7edCF04389260D1Fa4c697` (testnet). **[V]**
- `SpotRouter.deploySpotMarket(...)` from a random address reverts `Unauthorized()`. **[V]** Tokens are also whitelisted (`whitelistSpotToken`). v2 market creation is permissioned even on testnet.
- v2 includes integrator **builder fees**: `AccountCore.approveBuilder`, `claimBuilderFees`, builder referrals. It also has passive liquidity (`mintPassiveLiquidity`), post-fill hooks, a relay at `relay.testnet.kuru.io`, and EIP-7702 `KuruTradingWallet` intents. **[D]**
- None of v2 is on mainnet. Kuru's mainnet is v1. **[V]** (`exchange.kuru.io` only lists v1 markets.)

### 1.2 What the team probably means: Perpl (live perps on Monad)

Source docs: https://docs.perpl.xyz/llms-full.txt (Overview, Networks, Builder Codes, Funding, Price Indices, SDK).

| Item | Mainnet (143) | Testnet (10143) |
|---|---|---|
| Exchange contract (proxy) | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F` **[V]** code present, impl `0xa9ab97a4…`, 128 KB, 166 selectors incl. `createAccount(uint256)`, `depositCollateral(uint256)`, `getAccountByAddr(address)` | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` **[V]** same impl size and selectors |
| Collateral | AUSD `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` (6 dp) | aUSD `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` (6 dp). `mint()` is access-controlled, since a random-caller simulation reverts **[V]**. How to get testnet aUSD is not documented **[U]** |
| REST / WS | `https://app.perpl.xyz/api`, `wss://app.perpl.xyz` | `https://testnet.perpl.xyz/api`, `wss://testnet.perpl.xyz` |
| Markets (live `GET /v1/pub/context`) **[V]** | BTC 1, MON 10, ETH 20, SOL 31, HYPE 40, ZEC 50, LIT 60, VVV 70, PUMP 90 | BTC 16, ETH 32, SOL 48, MON 64, ZEC 256, LIT 272, PUMP 320 |
| Max leverage (`initial_margin` in hundredths of x) **[V]** | BTC 15x, ETH/SOL 12x, MON/HYPE/ZEC 10x, PUMP 5x, LIT/VVV 3x | similar |
| Fees **[V]** | maker 45 / taker 345 in micros (0.0045% / 0.0345%), tiered | |

**How it works [D]**
- Isolated margin only.
- On-chain CLOB with `execOrders(OrderDesc[], bool revertOnFail)`. Request types: 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort, 4 Cancel, 5 IncreasePositionCollateral, 6 Change (amend in place).
- To trade you first need an on-chain account, created with `createAccount(uint256 amountCNS)`. The minimum is 10 AUSD on mainnet and 100 aUSD on testnet.

**Oracle and funding [D]**
- The spot index comes from **Chainlink Data Streams**. It is pushed on-chain when the price moves >0.1% or when the value is within 10 s of max age.
- The mark price is the median of: external CEX mids, basis-adjusted spot, Perpl impact mid, and Perpl book price.
- Funding is applied every **8,571 blocks** (~hourly). The rate is set up to 143 blocks in advance by a *permissioned* setter, clamped, and uses the impact-price method. Settlement is virtual/lazy.
- There is liquidation, an insurance fund, ADL, OI caps and withdrawal limits.

**Two ways to integrate programmatically [D]**
1. **Direct on-chain.** The user's wallet calls `Exchange.execOrders(...)`, plus `createAccount` / `depositCollateral`. No API key is needed. Builder fees are **not** possible on this path.
2. **API.** There is a REST + WS trading socket (`/ws/v1/trading`, `OrderRequest mt:22`, fields `mkt, acc, t, p, s, fl, lv, lb, bf`).
   - Authentication is an **Ed25519 API key** enrolled once with a wallet EIP-712 signature: `POST /api/v1/api-key/payload` then `/enroll`.
   - Programmatic enrollment requires Perpl to **whitelist your Origin**.
   - **Builder codes:** Perpl registers you (id 1..255, via a Google form linked from `features.builderApplyUrl`). Each order can then charge up to 0.1% (`bf` ≤ 100 per_100k) on opening/increasing size. Withdrawals are never allowed through an API key.
   - There is a Rust SDK (`perpl-sdk`, `perpl-cli`). There is no official TS SDK, but the docs give raw TS snippets using `@noble/ed25519`.

**Restrictions and gaps**
- Perpl's context JSON has a `geo_block` list: BY, CU, GB, IR, KP, RU, SY, UA, US. **[V]** It is probably enforced in their UI and API **[U]**. This matters for a consumer app.
- There is no permissionless perp listing. Juno post-tokens cannot get perps on Perpl.

Other Monad perps venues, all **[U]** and unchecked: Monday Trade (launched on mainnet in Dec 2025, "up to 33x"), Drake Exchange (CLOB+AMM perps, testnet), Bean Exchange. Mentioned in https://bingx.com/en/learn/article/what-are-the-top-crypto-projects-in-monad-ecosystem-to-watch and https://github.com/amalnathsathyan/perps-lab/blob/main/research/monad-metropolis-percolator-feasibility.md

---

## 2. Spot integration surface (Kuru v1: the one live on mainnet)

### 2.1 Addresses

| Contract | Mainnet | Testnet |
|---|---|---|
| Router (proxy) | `0xd651346d7c789536ebf06dc72aE3C8502cd695CC` (impl `0xf1635175…`), owner = **Safe 1.4.1, 3-of-5** `0x8B736DCe2071783Fd9DB0a423dad17cc8ed5788b` **[V]** | `0x7EFbE105Ca7415dE98F96622173458ac1c054630` (impl `0xaaa0f0c4…`), owner = EOA `0x07bBBf2e…` **[V]** |
| MarginAccount | `0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5` **[V]** | `0xd029C2D98ff85D8F64799017fE00a59B1159CE02` **[V]** |
| OrderBook impl / Vault impl | `0x5e3446c6…` / `0x17ecCB57…` **[V]** | `0x72caE0a9…` / `0x4d54e0d6…` **[V]** |
| KuruForwarder (ERC-2771 meta-tx) | `0x974E61BBa9C4704E8Bcc1923fdC3527B41323FAA` **[V]** | `0x681bB1508E14433b148a2549ba2726454aDc9BB4` **[V]** |
| MonadDeployer (token + market + seeded vault) | `0xe29309e308af3EE3B1a414E97c37A58509f27D1E` **[V]** | `0xDacd06372cEb638640c9D8466A023b7362324e1A` **[V]** |
| KuruUtils | n/a | `0xE0841E0F06c5770C1D4930EC6C507ee33199C88C` **[V]** |
| KuruFlowEntrypoint / FlowRouter | `0xb3e6778480b2E488385E8205eA05E20060B813cb` / `0x0d3a1BE29E9dEd63c7a5678b31e847D68F71FFa2` **[V]** | none |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | Kuru test USDC `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570` (6 dp, **no mint function**) **[V]** |
| MON/USDC market | `0x065C9d28E428A0db40191a54d33d5b7c71a9C394` (vault `0x838c2d3f…`) | `0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9` **[V]**: effectively dead. There is one stale ask at ~1.001 USDC and no logs in the last 90 blocks |

Source: https://docs.kuru.io/contracts/Contract-addresses

- The addresses in the docs' **Quickstart** `config.json` are stale: `0xdDDaBd30…` and `0x1f5A250c…` have no code on testnet. **[V]**
- Kuru's active testnet effort is v2, so treat v1 testnet as "works, unmaintained" **[U]**.

### 2.2 Contract functions (deployed selectors checked against impl bytecode on both networks) **[V]**

**OrderBook (one per market)**
- Market orders: `placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool isMargin, bool isFillOrKill) payable returns (uint256 baseOut)` and `placeAndExecuteMarketSell(uint96 size, uint256 minAmountOut, bool isMargin, bool isFillOrKill) payable returns (uint256 quoteOut)`.
  - These cover IOC (`isFillOrKill=false`) and FOK.
  - The docs show `uint96 _minOut`. The deployed code uses `uint256`.
- Limit (GTC or post-only): `addBuyOrder(uint32 price, uint96 size, bool postOnly)`, `addSellOrder(...)`, `placeMultipleBuyOrders/SellOrders(uint32[],uint96[],bool)`, `batchUpdate(uint32[] buyPrices, uint96[] buySizes, uint32[] sellPrices, uint96[] sellSizes, uint40[] cancelIds, bool postOnly)`.
- Flip orders (auto-requote on the other side): `addFlipBuyOrder/addFlipSellOrder(uint32 price, uint32 flippedPrice, uint96 size, bool provisionOrRevert)`, `batchProvisionLiquidity(uint32[] prices, uint32[] flipPrices, uint96[] sizes, bool[] isBuy, bool provisionOrRevert)`, `addPairedLiquidity`, `batchAddPairedLiquidity`.
- Cancel: `batchCancelOrders(uint40[])`, `batchCancelFlipOrders(uint40[])`.
- Reads: `bestBidAsk() → (uint256,uint256)` (1e18-scaled), `getL2Book()` / `getL2Book(uint32,uint32)` (raw bytes: `[blockNumber][price,size]… 0 [price,size]…`, limit orders only), `getMarketParams()`, `getVaultParams() → (vault, vaultBestBid, bidPartiallyFilled, vaultBestAsk, askPartiallyFilled, vaultBidSize, vaultAskSize, spread)`, `s_orders(uint40)`.
  - The AMM vault levels are **not** in `getL2Book`. The SDK computes them from `getVaultParams` (`src/market/orderBook.ts`).

**MarginAccount**
- `deposit(address user, address token, uint256 amount) payable` (use `address(0)` for native)
- `withdraw(uint256 amount, address token)`
- `batchWithdrawMaxTokens(address[])`, which claims fills from limit orders. Filled limit orders credit the margin account, not the wallet. The UI calls these "Unclaimed assets".
- `getBalance(address user, address token)`

**KuruAMMVault (ERC-20 LP shares)**
- `deposit(uint256 baseDeposit, uint256 quoteDeposit, uint256 minQuoteConsumed, address receiver) payable`. This is the deployed signature. The SDK's `abi/KuruAMMVault.json` shows an older 3-arg `deposit`. Use `abi/Vault.json`, which matches the deployed code.
- `withdraw(uint256 shares, address receiver, address owner)`
- `previewDeposit/previewMint/previewWithdraw`, `totalAssets()`

**Router**
- `deployProxy(uint8 type, address base, address quote, uint96 sizePrecision, uint32 pricePrecision, uint32 tickSize, uint96 minSize, uint96 maxSize, uint256 takerFeeBps, uint256 makerFeeBps, uint96 kuruAmmSpread)`
- `computeAddress(...)`, `computeVaultAddress(...)`
- `anyToAnySwap(address[] markets, bool[] isBuy, bool[] nativeSend, address debitToken, address creditToken, uint256 amount, uint256 minOut) payable` for multi-hop across Kuru books.
- `verifiedMarket(address) → params`

**KuruForwarder (gasless / conditional)** **[V]**
- `execute(ForwardRequest, sig)`, `executePriceDependent(PriceDependentRequest, sig)`, `executeMarginAccountRequest(...)`, `cancelPriceDependent`. All are EIP-712.
- Allowed selectors on both networks: market buy/sell, `addBuyOrder`, `addSellOrder`, MarginAccount `deposit`/`withdraw`. `batchCancelOrders` is **not** allowed.
- `PriceDependentRequest` gives stop / take-profit style triggers: it executes only if `bestBid` crosses `price`, and a relayer submits it.
- Source: `contracts/KuruForwarder.sol`

**Events** **[V]**
- The docs claim these are indexed. On-chain, all events have **only topic0** and every parameter is in `data`.
- Trade: `Trade(uint40 orderId, address maker, bool isBuy, uint256 price /*1e18*/, uint96 updatedSize, address taker, address txOrigin, uint96 filledSize)`, topic `0xf16924fb…`
- Others: `OrderCreated(uint40,address,uint96,uint32,bool)`, `OrderCanceled(uint40,address,uint32,uint96,bool)`, `OrdersCanceled(uint40[],address)`, `FlipOrderCreated`, `VaultParamsUpdated`.
- Router: `MarketRegistered(base, quote, market, vault, pricePrecision, sizePrecision, tickSize, minSize, maxSize, takerFeeBps, makerFeeBps, kuruAmmSpread)`

### 2.3 Units (these trip everyone up)

- `price` args are uint32 in `pricePrecision` units. The maximum price is therefore `(2^32-1)/pricePrecision` quote per base.
- `size` / market-sell `_size` is uint96 in `sizePrecision` units of base.
- The market-buy `_quoteSize` is in **pricePrecision** units of quote. The SDK does `parseUnits(quote, log10(pricePrecision))`.
- `minAmountOut` is in raw token decimals of the output token.
- Native MON: `msg.value` must equal `quoteSize * 10^quoteDecimals / pricePrecision` exactly. The contract checks `>=` and `< (quoteSize+1)` equivalents.
- `bestBidAsk`, `Trade.price` and vault prices are 1e18-scaled.

### 2.4 Free on-chain quotes **[V]**

`OrderBook` has a special path when `msg.sender == address(0)`: it matches without moving funds and returns the output. The SDK's `CostEstimator` relies on it.

Mainnet MON/USDC, `eth_call` from `0x0`:
- `placeAndExecuteMarketBuy(1e9 /*10 USDC*/,0,false,false)` returns `416.09 MON`
- `placeAndExecuteMarketSell(1e12 /*100 MON*/,0,false,false)` returns `2.4028 USDC`

This gives exact, vault-inclusive quotes for any Kuru market, including testnet ones where Flow does not exist.

### 2.5 SDKs

- `@kuru-labs/kuru-sdk`: npm `latest` is 0.0.95 (2026-01-27). It depends on **`ethers` 5.7.1**, plus axios and cross-fetch. **[V]** (`npm view`)
  - Classes: `ParamFetcher.getMarketParams`, `IOC.placeMarket`, `GTC.placeLimit`, `OrderCanceler.cancelOrders`, `MarginDeposit.deposit`, `CostEstimator.estimateMarketBuy/estimateRequiredBaseForSell`, `OrderBook.getL2OrderBook`, `PositionViewer.get{Spot,BidAsk,Curve}BatchLPDetails` + `PositionProvider.provisionLiquidity`, `Vault.depositWithAmounts/withdraw`, `ParamCreator.calculatePrecisions/deployMarket`, `MonadDeployer.deployTokenAndMarket`, `PathFinder` + `TokenSwap` (Router `anyToAnySwap`).
  - Sources: https://docs.kuru.io/sdk/orderbook-sdk, https://github.com/Kuru-Labs/kuru-sdk
- `kuru-sdk-py` is Python for market makers: EIP-7702 MM entrypoint, batch cancel/replace. It is not relevant for a mobile app.
- `@toxicflow-labs/ts-sdk` is viem-only but targets **v2 contracts** (testnet), not v1 markets.
- **Is direct viem practical? Yes.** The ABI JSONs in `github.com/Kuru-Labs/kuru-sdk/tree/main/abi` (use `OrderBook.json`, `MarginAccount.json`, `Vault.json`, `Router.json`) match deployed selectors. My Foundry simulation called every piece Juno needs directly. You only need to port about 30 lines of maths: `calculatePrecisions`, and the L2 decoding plus vault-level synthesis from `getVaultParams` if you draw a depth chart.

### 2.6 Kuru Flow aggregator API **[V]**

Source: https://docs.kuru.io/kuru-flow/flow-overview, openapi at `https://docs.kuru.io/kuru-flow/openapi.json`

- `POST https://ws.kuru.io/api/generate-token` with `{"user_address":"0x…"}` returns `{token (JWT, 24h), expires_at, rate_limit:{rps:1,burst:1}}`. There is an alternative `X-API-Key` header for higher limits; you have to ask Kuru for it **[U]**.
- `POST https://ws.kuru.io/api/quote` with `Authorization: Bearer <jwt>`. Body:
  - required: `userAddress`, `tokenIn`, `tokenOut` (use `0x0` for MON), `amount` (raw)
  - then either `autoSlippage:true` or `slippageTolerance` (bps)
  - optional **`referrerAddress`, `referrerFeeBps`**, which is how Juno could earn fees on swaps
- Live response shape (it differs from the spec): `{type, status, output, minOut, transaction:{calldata /*hex, no 0x prefix*/, value, to: 0xb3e6…(KuruFlowEntrypoint)}, gasPrices}`.
  - Test: 100 MON → USDC returned output 2.404574 USDC with referrer 25 bps.
- ERC-20 `tokenIn` must be approved to `0xb3e6778480b2E488385E8205eA05E20060B813cb`. Source: https://github.com/Kuru-Labs/kuru-trading-skills
- **Testnet is not supported.** Quoting to testnet USDC returns `no candidate paths available between tokens`, and there is no testnet host.
- Coverage: Kuru CLOBs plus Uniswap v3/v4 pools (exchangeInfo lists `MON_USDC_V3_5`, `MON_USDC_V4_5`, and others). A long-tail Kuru market (`emo/MON`) routed fine. A random WMON pair from a v2-style factory `0xA25b1312…` had no path, but that pair also has zero reserves. Whether Flow indexes arbitrary Uniswap-v2 forks is **[U]**.

---

## 3. Market creation (the `KuruGraduator` question)

### 3.1 Permissions (re-verified)

| Call | Mainnet | Testnet |
|---|---|---|
| `Router.deployProxy` from random EOA | reverts `0x82b42900 Unauthorized()` **[V]** | succeeds, e.g. returns `0xB0f97534…` for USDC/MON with params below. Gas estimate about 1.08M **[V]** |
| `Router.deployProxy` from owner Safe `0x8B736DCe…` | succeeds **[V]** | n/a |
| `Router.deployProxy` from `0xb624377f…` (the EOA that created **every** existing mainnet market, including the community `emo/MON` and XAUt) | now reverts `Unauthorized()` **[V]**. The gate or ownership change happened after block ~76.3M | n/a |
| `MonadDeployer.deployTokenAndMarket` (random EOA, 10 MON) | reverts `Unauthorized()` (via Router) **[V]** | succeeds **[V]** |
| v2 `SpotRouter.deploySpotMarket` | not deployed | reverts `Unauthorized()` **[V]** |

- The public source has `deployProxy` with **no** access control. Mainnet runs an upgraded Router impl (2 extra selectors, `0x71181c28` and `0xea217e47`, both `(address,address,uint256[])`) that gates it. **[V]**
- **Mainnet listing of a Juno token therefore needs the Kuru team.** Options: they call `deployProxy` from the Safe, or allowlist Juno's graduator (no such function is visible, so it would have to go through their team) **[U]**.

### 3.2 Parameter rules (from `Router.sol`, `OrderBook.initialize`, and simulated reverts) **[V]**

- `type`: 0 = NO_NATIVE (both ERC-20), 1 = NATIVE_IN_BASE (base = `0x0`), 2 = NATIVE_IN_QUOTE (quote = `0x0`). A Juno token priced in MON is **type 2** (base = token, quote = `0x0`).
- `sizePrecision` and `pricePrecision` must be exact powers of 10. Otherwise you get `InvalidSizePrecision` / `InvalidPricePrecision` (`0xa7bee359`). `tickSize > 0`.
- `makerFeeBps <= takerFeeBps < 10000`. Otherwise `MarketFeeError` (`0xa9269545`).
- `kuruAmmSpread % 10 == 0 && 0 < spread < 500`. Otherwise `InvalidSpread` (`0x3cd146b1`). The docs recommend 100 for volatile pairs and 30 for stable ones.
- The market and vault addresses are CREATE2 from a salt over all params. `computeAddress(..., address(0), false)` predicts them.
- The protocol fees (taker minus maker) go to Kuru's fee collector through `MarginAccount.creditFee`. **The market creator earns nothing.** The vault earns the spread.

`ParamCreator.calculatePrecisions(quote, base, maxPrice, minSize, tickBps)` in `src/create/market.ts` works like this:
- `price = quote/base`
- `tick = max(price*tickBps/1e4, price/1e6, 1e-8)`
- `priceDecimals = max(decimals(price), 4, decimals(tick))`, capped at 9. So the minimum representable price is 1e-9.
- `sizeDecimals = max(decimals(minSize), floor(log10(maxPrice*10^priceDecimals)))`
- `maxSize = 10^(digits((2^32-1)*sizePrecision/price) - 1)`

A worked example for a Juno graduation of 1,000 MON against 200M tokens (price 5e-6 MON):
- `pricePrecision 1e8`
- `tickSize 5` (1%)
- `sizePrecision 1e8`
- `minSize 1e11` (1,000 tokens)
- `maxSize 1e14`
- max representable price ≈ 42.9 MON per token

**Constraint for Juno:** prices are uint32. Choose `pricePrecision` so that the graduation price has several significant digits *and* 1000x headroom. With a 1B supply and graduation around 1e-6 to 1e-4 MON, 1e8 or 1e9 fits.

### 3.3 Can the AMM vault be seeded at creation? Yes, verified end to end on testnet

`MonadDeployer` already does it (deploy + `vault.deposit` + LP kept by the deployer contract).

I wrote `scratchpad/kuru/sim/src/Sim.sol` and ran it as a contract-creation `eth_call` on testnet with a balance override. It does the following:
- Deploys a Juno-like token that refuses transfers to a locked venue, with the venue set to the **Kuru MarginAccount**.
- Pre-graduation `MarginAccount.deposit(token)`: **blocked** (`preBlocked = true`).
- Unlocks, then calls `deployProxy(2, token, 0x0, 1e8, 1e8, 5, 1e11, 1e14, 30, 10, 100)` and gets market `0x87b6…` and vault `0x37af…`.
- Calls `vault.deposit{value: 1000 MON}(200M tokens, 1000 MON, 1000 MON, 0xdEaD)` and gets shares `4.472e23` (sqrt(b·q) − 1000; 1000 min-liquidity shares go to MarginAccount).
- Reads `bestBidAsk()`: ask = **5.000e-6 MON (exactly the curve's final price)**, bid = 4.9505e-6 (ask/1.01).
- Buys with 1 MON and receives 199,400 tokens (= 1/5e-6 minus 0.3% taker fee).
- Sells 100k tokens and receives 0.49356 MON.
- Total gas for the whole script is about 2.43M (Monad bills the **gas limit**, so set it explicitly).
- On mainnet the same script reverts `Unauthorized()`.

The first deposit sets the vault price to `quoteDeposit·1e18/baseDeposit` (normalised). Nobody can front-run it, because the token cannot enter MarginAccount before graduation and the vault needs base tokens for the first deposit.

### 3.4 Sketch of a `KuruGraduator implements IJunoGraduator`

1. **`prepare(token, quote)`**: return `KURU_MARGIN_ACCOUNT` as the venue to lock.
   - Every Kuru token flow (limit orders, market sells, vault deposits, Router `anyToAnySwap`, Forwarder) moves tokens into `MarginAccount`. `JunoToken`'s `to == pair` lock therefore blocks every Kuru market for that token until `markGraduated()`.
   - This relies on the launchpad calling `markGraduated()` *before* `graduator.graduate()`, which it does (`JunoLaunchpad.graduate`).
   - Optionally, deploy the market here instead. That is fine on testnet.
2. **`graduate(token, quote, base, quoteAmt)`** (native MON quote):
   - Compute the params from the price `quoteAmt/base`.
   - Compute `m = router.computeAddress(token, 0x0, …, address(0), false)`.
   - If `router.verifiedMarket(m).pricePrecision == 0`, call `m = router.deployProxy(2, token, 0x0, …)`. Otherwise reuse the existing market. This matters because anyone can pre-deploy an identical-param market on testnet to grief a CREATE2 collision. Its vault must still be empty, because base could not enter MarginAccount.
   - Then `(vault,,,,,,,) = IOrderBook(m).getVaultParams()`, `token.approve(vault, base)`, and `liquidity = vault.deposit{value: quoteAmt}(base, quoteAmt, quoteAmt, 0x…dEaD)`.
   - Return `(m, liquidity)`.
   - For an ERC-20 quote, use type 0 and approve both tokens to the vault.
3. **Mainnet:** this only works if Kuru's Safe deploys each market, or allowlists the graduator. Plan a fallback: keep `UniswapV2Graduator` on mainnet and use `KuruGraduator` on testnet, or ask Kuru before submission.

---

## 4. Data APIs (mainnet only unless noted)

- **REST `https://exchange.kuru.io`** (OpenAPI `https://docs.kuru.io/kuru-exchange/openapi.yaml`) **[V]**
  - `/health`
  - `/api/v3/exchangeInfo` (12 symbols: 7 Kuru CLOBs MON_USDC, WETH_USDC, MON_AUSD, cbBTC_USDC, AUSD_USDC, WBTC_AUSD, XAUT_USDC, plus 5 Uniswap v3/v4 pools)
  - `/api/v3/depth?symbol=MON_USDC&limit=&state=proposed|voted|finalized|committed`
  - `/api/v3/trades`, `/api/v3/ticker/24hr`
  - `/api/v3/klines` returned `[]` for MON_USDC at every interval I tried **[V]**. Treat candles as unreliable and build your own from `Trade` events.
  - Values are raw integers: prices 1e18, sizes in sizePrecision units (inferred from sizes). The spec's examples show decimal strings, which is wrong.
  - Rate limit: 1200 weight/min per IP, burst 100.
- **WS `wss://exchange.kuru.io/ws`** **[V]**
  - Send `{"method":"SUBSCRIBE","params":["MON_USDC@depth5","MON_USDC@trade"],"id":1}`.
  - Streams: `@depth`, `@depth5/10/20`, `@depth@<state>`, `@monadDepth`, `@trade`.
  - Frames arrive as **binary** containing JSON text, e.g. `{"e":"trade","s":"0x065c…","p":"23908000000000000","q":"208000000000000","m":true,…}`.
  - Limit: 5 connections per IP.
- **REST `https://api.kuru.io`** **[V]**
  - `/api/v1/markets`: 100 entries. It includes non-Kuru pools. Each entry has `kuruammvault`, token metadata (logo, verified), `lastPrice`, 5m/1h/24h volume, trade counts, unique traders and price change. This is useful for a "discover/trending" feed.
  - `/api/v2/{user}/user/orders/active/{market}`
  - `/api/v3/{user}/user/order-events?marketAddress=&fromTimestamp=&eventType=`
- Frontend orderbook WS `wss://ws.kuru.io/` (Python SDK `KuruFrontendOrderbookClient`) **[D]**
- Daily L2 Parquet snapshots `https://kuru-l2-snapshots.s3.amazonaws.com/market=<addr>/date=YYYY-MM-DD/l2_book_snapshots.parquet` **[D]**
- Tx revert simulator `https://mm-tx-simulator.aws.kuru.io/tx/<hash>` (1 rps) **[D]**
- Indexing guide: Router `MarketRegistered`, then each market's `Trade`. Source: https://docs.kuru.io/contracts/Integration
- **Testnet v1 has no hosted data.** Read `bestBidAsk`, `getVaultParams`, the `address(0)` quote, and events via RPC or Envio.
- v2 testnet gateway: `https://api.testnet.kuru.io/api/v1/markets` **[V]**, plus the binary `KXMD` WS decoded by `@toxicflow-labs/ts-sdk/exchange-ws` **[D]**.

---

## 5. Metropolis bounties (Track 01)

- The official page lists Kuru's two sponsor bounties: **"Build the Next Consumer Trading App on Kuru" $5,000** and **"Bring New Assets and Markets to Kuru" $5,000**. Both cards link to kuru.io. **[V]** Source: https://monad.xyz/developers/hackathons/metropolis
  - **No criteria are published publicly.** The details are behind the login-gated platform https://hackathon.monad.xyz/.
- Participant copy of the consumer-app criteria **[U]**, from https://github.com/EndPx/kairos/blob/main/docs/HACKATHON_REQUIREMENTS.md:
  - "Working focused spot product routing through Kuru onchain order book on Monad."
  - "Judging and deliverables: integration strength, clear target user, evidence of demand through usage/trading activity, credible acquisition/retention and plan after hackathon."
  - "No minimum users or explicit mainnet volume requirement."
  - I found **no** participant copy of the "New Assets and Markets" criteria. Another repo only says "titles only, no public criteria".
- General rules:
  - Build 1 Sep–13 Oct. Judging 14–27 Oct. Winners on 3 Nov.
  - Submit "a working product with a public project profile: a demo, a short write-up, and a link to the code".
  - Track 01 is $30k across 3 teams. Its suggestions include "perpetuals with block-by-block funding updates".
  - Your own `xorr-metropolis/PLAN.md` also records: deployed on mainnet or testnet, OSI licence, foundation/AI tools disclosed in the README, demo video ≤3 min **[U]**.
- Adjacent bounties Juno fits:
  - Agora **Best Mobile Trading App on Monad $10k**
  - Perpl **Best use of Perpl's API $5k** and **Best Analytics/Risk Tool $3k**
  - Privy $5k ("beyond login" per participant notes **[U]**)
  - Monad Foundation Mera ×2 ($2.5k each)
  - Envio $1k
- Kuru CEO Vaibhav is listed as a mentor. Asking him directly for the criteria, and for a mainnet market or graduator allowlist, is the fastest unblock.

---

## 6. Kuru capabilities Juno can use for real

1. **Graduate post-tokens into Kuru CLOB+AMM markets** instead of (or alongside) Uniswap v2.
   - Calls: `Router.deployProxy(2, token, 0x0, …)` + `KuruAMMVault.deposit(base, quote, minQuote, 0xdEaD)` in `graduate()`, with the token lock pointed at `MarginAccount`.
   - The market opens at exactly the curve price, has locked liquidity, and has a limit-order book from day one.
   - Testnet now. Mainnet needs Kuru.
2. **Buy/sell buttons on every post, with exact quotes.**
   - Quote with `eth_call` from `address(0)` on `placeAndExecuteMarketBuy/Sell`.
   - Execute with `placeAndExecuteMarketBuy{value}(quoteSize, minOut, false, true /*FOK*/)` and `placeAndExecuteMarketSell(size, minOut, false, false)`.
3. **Limit orders from the feed** ("buy $TOKEN if it dips to X"). Deposit once with `MarginAccount.deposit`. Place with `addBuyOrder/addSellOrder(price, size, postOnly)`. Cancel with `batchCancelOrders`. Claim with `batchWithdrawMaxTokens`. Track with `OrderCreated`/`Trade`/`OrderCanceled` events or `api.kuru.io` active-orders.
4. **Gasless trading and on-chain stop / take-profit.** The user signs EIP-712 `ForwardRequest` / `PriceDependentRequest` and Juno's relayer submits `KuruForwarder.execute` / `executePriceDependent`.
   - Allowed: market orders, limit orders, margin deposit/withdraw. Cancels are not allowed.
   - With a native quote the relayer must front `msg.value`, so gasless flows fit best with `isMargin=true` balances.
5. **Creator- or community-run liquidity.** "Back this creator" can deposit into the market's vault (`KuruAMMVault.deposit`, receiving LP shares) or place flip-order ranges (`batchProvisionLiquidity` with flip prices). LPs earn the spread.
6. **Swap any Monad token into a post-coin (mainnet).** Use Kuru Flow `POST /api/quote` then send `transaction.{to,calldata,value}`. Setting `referrerAddress` / `referrerFeeBps` gives Juno revenue.
7. **Social proof and market data in the feed.**
   - Live price/depth: `bestBidAsk`, `getVaultParams`, the `exchange.kuru.io` WS `@trade` / `@depth5`.
   - Trending: `api.kuru.io/api/v1/markets` 5m/1h/24h stats.
   - "Who bought": `Trade` event `taker` / `txOrigin`.
   - Portfolio: `MarginAccount.getBalance`, `api.kuru.io` order-events.
8. **Multi-hop in one tx** across Kuru books, e.g. token → MON → USDC, with `Router.anyToAnySwap`.
9. **Perps inside Juno (through Perpl, not Kuru).**
   - "Long/short MON/BTC/ETH from a post" via `Exchange.createAccount` + `execOrders(OrderDesc[])` from the user's wallet.
   - Alternatively, use the Perpl API with a registered builder code, which earns up to 0.1% on opens. This needs Perpl to whitelist Juno's Origin for key enrollment.
   - Perpl markets are fixed majors only, so post-tokens cannot get perps.

---

## Key sources

- Kuru docs, full dump: https://docs.kuru.io/llms-full.txt; addresses https://docs.kuru.io/contracts/Contract-addresses; deploy https://docs.kuru.io/sdk/deploy-market; Flow https://docs.kuru.io/kuru-flow/flow-overview
- Kuru contract source: https://github.com/Kuru-Labs/Kuru-contracts-dex-public (Router.sol, OrderBook.sol, KuruAMMVault.sol, KuruForwarder.sol, periphery/MonadDeployer.sol)
- Kuru SDK: https://github.com/Kuru-Labs/kuru-sdk (abi/, src/create/market.ts, src/market/ioc.ts, src/market/orderBook.ts); npm https://www.npmjs.com/package/@kuru-labs/kuru-sdk
- Kuru v2 SDK: https://github.com/Kuru-Labs/ts-sdk; Flow skill: https://github.com/Kuru-Labs/kuru-trading-skills
- Perpl: https://docs.perpl.xyz/llms-full.txt, https://docs.perpl.xyz/resources/for-developers/networks-and-configuration, https://docs.perpl.xyz/resources/for-developers/api/builder-codes, https://docs.perpl.xyz/exchange/funding, https://docs.perpl.xyz/exchange/price-indices
- Hackathon: https://monad.xyz/developers/hackathons/metropolis, https://hackathon.monad.xyz/, participant notes https://github.com/EndPx/kairos/blob/main/docs/HACKATHON_REQUIREMENTS.md and https://github.com/amalnathsathyan/perps-lab/blob/main/research/monad-metropolis-percolator-feasibility.md
