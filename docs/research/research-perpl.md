# Perpl integration spec (Monad testnet, chain 10143)

Researched 2026-09-24 against testnet blocks ~65.18M. Exchange proxy `0x1964C32f0bE608E7D29302AFF5E61268E72080cc`, implementation slot = `0xbcbd3701ed0bde8acbb727f0d92a8b85a169adbb`, `getContractVersion()` = (1, 7, 5).

Legend: **[V]** means I checked it myself with read-only `eth_call`, `eth_estimateGas`, storage reads, `eth_simulateV1` with state overrides (no transactions sent anywhere), or a live HTTP call. **[D]** means it comes from Perpl or Agora docs or the SDK source. **[U]** means unverified or inferred.

Sources:
- SDK: `PerplFoundation/dex-sdk` @ `01b99107` (2026-09-23), ABI REVISION `rc_v1.1.7-203-g0e5902dd`. This matches `.juno/perpl/REVISION`.
- `PerplFoundation/dex-sdk-examples` @ `c2a30986`.
- `PerplFoundation/api-docs` @ `e1ba1a78`.
- `https://docs.perpl.xyz/llms-full.txt`.
- Agora docs: `docs.agora.finance/developer/contract-deployments`.

---

## TL;DR

1. **Trading directly from a wallet takes three calls:**
   - `AUSD.approve(Exchange, amt)`
   - `Exchange.createAccount(amt ≥ 100 AUSD)`
   - `Exchange.execOrder(OrderDesc)`
   
   I simulated the whole loop end to end on live testnet with `eth_simulateV1`: approve → create → open long IOC → read position → close IOC → flat. It filled at the best ask and then the best bid. **[V]**
2. **A "market" order is a marketable-limit IOC.**
   - Set `immediateOrCancel=true`, `pricePNS = worst acceptable price` (mark ± slippage), `amountCNS=0`, `expiryBlock=0`.
   - The contract takes collateral as `fill notional / leverage`, and adds any fill-vs-mark loss (capped by `maxNegPnlCollatBPS`). `amountCNS` is only used by `IncreasePositionCollateral`. **[V]**
3. **Units:**
   - `pricePNS = price × 10^priceDecimals`. This is absolute, not relative to `basePricePNS`.
   - `priceONS = pricePNS − basePricePNS`. It is only used in book views.
   - `lotLNS = size × 10^lotDecimals`.
   - `CNS` is AUSD with 6 decimals.
   - `leverageHdths = leverage × 100`.
   
   **[V]**
4. **Stale prices block opens but not closes.**
   - If `block.timestamp − markTimestamp ≥ 60 s` (`refPriceMaxAgeSec=60` on every perp), opening or increasing reverts with `MarkPriceAgeExceedsMax` (sometimes `TakerOrderSettlementFailed(..., resultCode=13)`).
   - Closes, `IncreasePositionCollateral`, deposits, withdrawals and resting post-only orders still work. **[V]**
   - **The local anvil fork is already ~35 min stale, so every open on it reverts right now.** **[V]**
   - The fork workaround (owner `setIgnOracle` plus a price-admin mark keeper) works in simulation. **[V]**
5. **Blocker: getting testnet AUSD.**
   - `AUSD.mint` has access control: one minter, an Agora EOA. **[V]**
   - Agora's faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (`requestFunds(address)` → 10,000 AUSD) is deployed on Monad testnet but **currently reverts `InsufficientFunds()`**. It holds exactly 10,000 AUSD, and its last drip was about 5 h ago. **[V]**
   - The minimum account open is 100 AUSD. **[V]**
   - Options: ask Agora or Perpl on Discord for a refill, or on the fork use `anvil_setStorageAt` (slot formula in §7). **[U]** No other public faucet exists.
6. **Pitfalls**:
   - The REST/WS enums are **1-based** (`OpenLong=1`). The on-chain enums are **0-based** (`OpenLong=0`). **[D]**
   - `getPositionV2` on an empty slot returns zeros with `positionType=0` (Long), so test `lotLNS>0`. **[V]**
   - An IOC that finds no liquidity **does not revert**: it emits `ImmediateOrCancelExecuted(unmatched,total)`. **[V]**
   - Leverage above the max is silently clamped to the max. **[V]**
   - Testnet MON max leverage is **3x** with 20% maintenance margin, not the mainnet 10x. **[V]**

---

## 0. Constants (testnet)

| Item | Value | |
|---|---|---|
| Exchange (UUPS proxy) | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` | [V] |
| Exchange owner | `0x582ea4aBe762A303A934E5983a2CdDeC336193B1` (a contract, likely a Safe) | [V] |
| Price administrators (EOAs) | `0xd0b6c28090c79e3edf0d414d92e1f1e07009501d`, `0xf68ec47423338afd82caa1ecbb9f9066c2ec7dea`. They push prices via `execPerpOps` | [V] |
| AUSD (proxy, Agora) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 dp, impl `0xc1e3c7d4…12da` | [V] |
| `getMinAccountOpenCNS()` | `100000000` (100 AUSD) | [V] |
| `getMinimumPostCNS()` / `getMinimumSettleCNS()` | 0 / 0 | [V] |
| `getRecycleFeeCNS()` | `100000` (0.1 AUSD) | [V] |
| `isHalted()` / `whitelistingEnabled()` | false / false | [V] |
| `getFundingInterval()` | 8571 blocks (API: `funding_interval_sec` 2580) | [V] |
| `numberOfAccounts()` | 693 at research time | [V] |
| Perps | 16 BTC, 32 ETH, 48 SOL, 64 MON, 256 ZEC, 272 LIT, 320 PUMP. `getPerpetualExistsBitmap()` only covers IDs <256 (16/32/48/64) | [V] |

---

## 1. Units and conversions

| Unit | Meaning | Scale | Source |
|---|---|---|---|
| **PNS** (price, native scale) | Absolute price. Used in `OrderDesc.pricePNS`, `markPNS`, `oraclePNS`, position `pricePNS` | `price × 10^priceDecimals` | SDK `to_order_desc` uses `price_converter.to_unsigned(price)` (types/request.rs:219), with `Converter::new(priceDecimals)` (state/perpetual.rs:103) [D]; fills match [V] |
| **ONS** (order-book scale) | Offset from the perp's base price. Used in book views (`maxBidPriceONS`, `getOrder*.priceONS`, `getVolumeAtBookPrice`) | `pricePNS − basePricePNS` | SDK state/order.rs:96 `price = base_price + priceONS` [D]; BTC `minAskPriceONS 792110 + base 50000 = 842110` = last trade [V] |
| **LNS** (lot) | Size | `size × 10^lotDecimals`. Minimum is 1 lot | request.rs:220, perpetual.rs:104 [D]; docs "Minimum Orders" [D] |
| **CNS** (collateral) | AUSD amount | `× 10^6` | [V] |
| leverage / margin fractions | Hundredths | `leverageHdths = L×100`. `perpInitMarginFracHdths` = max leverage (1500 = 15x). `perpMaintMarginFracHdths` M means MMR = notional/(M/100) (2500 → 4%) | `LEVERAGE_SCALE = 2` perpetual.rs:8 [D]; margin docs [D]; simulated `leverageHdths:500` gave deposit = notional/5 [V] |
| fees | ppm (contract v1.7.5) | `getTakerFee=345` = 3.45 bps. `getMakerFee=45` = 0.45 bps | [V]; num.rs FEE_SCALE_PPM [D] |
| `fundingRatePct100k` | Funding per interval, in 1e-5 | 4 = 0.004% per interval. The API reports the same value as micros (`rate: 40`) | [V] |

**Price range per perp.** `PriceOutOfRange(0, 50001, 16827215)` for BTC shows that a valid `pricePNS` is in `[basePricePNS+1, basePricePNS + 2^24 − 1]`. **[V]**
- So a "no-limit" sell must use `basePricePNS+1`, never 0.
- The old example repo's `price=0` / `UD64::MAX` market orders now revert.

**Notional in CNS:** `pricePNS × lotLNS × 10^(6 − priceDecimals − lotDecimals)`. The contract requires `pd + ld ≤ 6` (error `ContractDecimalsExceedResolution`). **[V]**

**Worked examples (`getPerpetualInfoV2`):**
- **BTC (16):** pd=1, ld=5, base=50000.
  - $65,000 → `pricePNS=650000` (`ONS=600000`).
  - 0.001 BTC → `lotLNS=100`.
  - Notional = 650000·100·10^0 = 65,000,000 CNS = $65. At 5x the margin is 13 AUSD.
  - Tick is $0.1. Price range is $5,000.1 to $1,682,721.5.
- **MON (64):** pd=5, ld=0, base=1.
  - $0.024 → `pricePNS=2400`.
  - 1000 MON → `lotLNS=1000`.
  - Notional = 2400·1000·10^1 = 24,000,000 CNS = $24.
  - Tick is $0.00001 (≈4 bps of price, which is coarse). The minimum size is 1 MON.

### `getPerpetualInfoV2` right now (block 65181577, ts 1790217656) [V]

| Field | BTC (16) | MON (64) |
|---|---|---|
| name / symbol | BTC Perp / BTC | MON Perp / MON |
| priceDecimals / lotDecimals | 1 / 5 | 5 / 0 |
| basePricePNS | 50000 ($5,000.0) | 1 ($0.00001) |
| markPNS / markTimestamp | 842195 ($84,219.5) / 1790217628 (age 28 s) | 2397 ($0.02397) / 1790217636 (age 20 s) |
| oraclePNS / oracleTimestampSec | 842524 / 1790217628 | 2400 / 1790217620 |
| lastPNS / lastTimestamp | 842110 / 1790217641 | 2395 / 1790217635 |
| refPriceMaxAgeSec | **60** | **60** |
| priceTolPer100K | 5000 (5%) | 5000 |
| marginTol / marginTolDecimals | 100 / 9 | 100 / 9 |
| long = short OI (LNS) | 2091257 (20.91 BTC) | 4108682 MON |
| positionBalanceCNS / insuranceBalanceCNS | 437,481.10 / 113,281.53 AUSD | 122,718.32 / 6,501.37 AUSD |
| fundingStartBlock / fundingRatePct100k / absFundingClampPctPer100K | 12179391 / 4 / 10 | 12179391 / 0 / 10 |
| fundingSumScalingExp | 0 | 3 |
| status | 4 (SDK treats 0 as paused; other values not documented) | 4 |
| maxBid / minAsk (ONS) | 792105 / 792110 → $84,210.5 / $84,211.0 | 2390 / 2406 → $0.02391 / $0.02407 |
| minBid / maxAsk (ONS) | 418866 / 831889 | 2366 / 16776215 (a far-away ask) |
| numOrders | 127 | 20 |
| ignOracle | false | false |
| linkFeedId | `0x00037da0…b439` | `0x000381c8…f60a` |
| `getMarginFractions(id,0)` | 1500 / 2500 / 1500 / oiMax 1e11 / 90 / 95 → **15x max, MMR 4%** | 300 / 500 / 300 / oiMax 1e8 / 90 / 95 → **3x max, MMR 20%** |
| taker / maker fee | 345 / 45 ppm | 345 / 45 ppm |

Other perps [V]:

| Perp | pd | ld | base | Max leverage | MMR |
|---|---|---|---|---|---|
| ETH 32 | 2 | 3 | 1 | 12x | 5% |
| SOL 48 | 2 | 3 | 1 | 10x | 5% |
| ZEC 256 | 3 | 3 | 0 | 3x | 10% |
| LIT 272 | 5 | 1 | 0 | 3x | 10% |
| PUMP 320 | 6 | 0 | 0 | 5x | 10% |

`getMarginFractions(perp, lotLNS)` returns a *dynamic* init fraction for large sizes (MON at 1e8 lots → 1). **[V]**

---

## 2. Enums (on-chain, 0-based)

| `OrderDescEnum` (`OrderDesc.orderType`) | Value |
|---|---|
| OpenLong | 0 |
| OpenShort | 1 |
| CloseLong (reduce-only ask) | 2 |
| CloseShort (reduce-only bid) | 3 |
| Cancel | 4 |
| IncreasePositionCollateral | 5 |
| Change | 6 |

- Source: SDK `crates/sdk/src/types/request.rs:38-46` and `From<u8>` at `:238-251`. **[D]**
- Confirmed on-chain: `OrderRequestV2.orderType` echoed 0 and 2, and `CloseShort` on a long reverted `CloseOrderPositionMismatch(0, 3)`. **[V]**
- `PositionEnum`: **Long=0, Short=1** (`state/position.rs:7-11, 272-279`). **[D]** Confirmed by simulation. **[V]**
- **The REST/WS API uses different numbering.** OrderType is `1=OpenLong … 7=Change`, `PositionType 1=Long, 2=Short`. **[D]** (docs Types & Errors). Do not mix them.
- `OpenLong` also reduces, closes or flips a short, and `OpenShort` does the same for a long. `Close*` orders are reduce-only. **[D]**

---

## 3. Placing a market-style order

**Function:** a wallet trading directly calls **`execOrder(OrderDesc)`** (or `execOrders(OrderDesc[], bool revertOnFail)` to batch, for example close+open).
- The `…V2` variants only add a `bytes extension` for builder-code attribution. An empty extension is the V1 path. **[D]** (request.rs:136-196, exec.rs)
- `execFwd*` are for the API relayer. They are not needed here.
- The account is always `msg.sender`, and `orderDescId` is free-form for direct calls. **[D]** (api-docs websocket.md:357)
- `execOrder` returns `{perpId:0, orderId:0}` for an IOC. The result is only in the events. **[V]**

### OrderDesc for open-long IOC, and for a full close

| Field | Open long IOC | Close long IOC (full) | Notes |
|---|---|---|---|
| orderDescId | any (e.g. `Date.now()`) | any | Echoed in `OrderRequestV2` [V] |
| perpId | 16 | 16 | |
| orderType | 0 | 2 (CloseShort=3 for shorts) | |
| orderId | 0 | 0 | Only for Cancel/Change |
| pricePNS | `ceil(ref×(1+slip))`, clamped to ≤ base+2^24−1 | `floor(ref×(1−slip))`, clamped to ≥ base+1 | Worst acceptable price; fills walk from the best level [V] |
| lotLNS | `size×10^ld` | `position.lotLNS` | Close > position → `CloseOrderExceedsPosition` [V] |
| expiryBlock | 0 | 0 | IOC never rests |
| postOnly / fillOrKill / immediateOrCancel | false / false / **true** | same | FOK that can't fill → revert (`TakerOrderSettlementFailed` code 3) [V] |
| maxMatches | 1..1000 (e.g. 100) | same | 0 → contract max 1000 [D] request.rs:302-311 |
| leverageHdths | `L×100` | any (ignored; SDK sends perp max) | 0 → max. Above max → **clamped to max, no revert** [V] |
| lastExecutionBlock | head + N (0 = none) | same | Past it → revert `ExceedsLastExecutionBlock` [V] |
| amountCNS | **0** | **0** | Only type 5 uses it [V] |
| maxNegPnlCollatBPS | 1000 (SDK default, API `order_max_neg_pnl_collat_bps`) | 1000 | Cap on extra collateral to cover fill-vs-mark loss, in bps of notional [D]; seen as `pnlCollateralizedCNS` [V] |

**Collateral (verified trace, BTC 0.001 @ 5x, 200 AUSD account):**
- The fill was at 842110 ($84,211.0).
- `PositionOpenedV2.depositCNS = 16,842,200` = 84.211/5.
- The taker fee was 29,053 CNS (3.45 bps; 4,358 to insurance + 24,695 to protocol).
- Balance went 200 → 183.128747.
- The close filled at 842105 with `deltaPnl −500` and fee 29,053, leaving a balance of 199.941394.
- **The taker close was charged a fee.** api-docs README says "closing or reducing is fee-free", but the simulation shows otherwise. **[V]**
- Leverage 0 → 15x (`depositCNS 5,614,067`). **[V]**

**Other verified behaviours:**
- An IOC with no liquidity inside the limit succeeds and emits `ImmediateOrCancelExecuted(unmatched=100,total=100)` with no position. **[V]**
- `execOrders([...], revertOnFail=false)` still reverts on a taker settlement failure. **[V]**
- A resting (non-IOC) order is debited the 0.1 AUSD recycle fee **even with `expiryBlock=0`** (docs say the fee applies only to expiring orders). **[V]** / [D]
- Partial IOC fills are possible, so re-read the position after the transaction.

**Gas** (`eth_estimateGas`) [V]:

| Call | Gas |
|---|---|
| approve | ~51k |
| createAccount | ~202k |
| execOrder IOC (1 match) | ~247k (open) / ~247k (close) |
| withdrawCollateral | ~135k |

- Monad bills the **gas limit**, not gas used. **[D]** (Monad docs) `eth_simulateV1` reports `gasUsed == gas limit`. **[V]**
- So send `estimate × ~1.2`, never a flat 30M.

---

## 4. Account lifecycle

| Step | Behaviour |
|---|---|
| `approve(Exchange, amt)` | **Required.** Without it `createAccount` reverts `ERC20InsufficientAllowance(0x1964…,0,1e8)` (selector `0xfb8f41b2`) [V] |
| `createAccount(amountCNS)` | Pulls AUSD and returns the new id (next id 694). Events `AccountCreated`, `CollateralDeposit` [V]. `amountCNS < 100e6` → `InsufficentAmountToOpenAccount(sender, amt)` [V]. Calling it twice → `AccountExists(sender,id)` [V]. `whitelistingEnabled=false` [V] |
| `depositCollateral(amt)` | Needs an existing account (else `AccountDoesNotExist`). **No on-chain minimum**: 1 CNS worked. The API's `min_deposit_amount` 10 AUSD is UI-only [V] |
| `withdrawCollateral(amt)` | Only **free** balance (`balanceCNS`). Collateral held in positions is not withdrawable (close first). Over-asking → `AmountExceedsAvailableBalance(amt, available, balance)` [V] |
| Withdraw rate limit | Global, not per user. The first withdrawal of a period emits `WithdrawRateLimitReset(newExpiryBlock=+8571, newLimitCNS=6,422,420 AUSD, perBlockCNS=749.3)`. The burst allowance is 1,605,742 AUSD (`getWithdrawAllowanceData`) [V]. Formula = max(10% TVL, $1M)/hour, 25% burst [D]. Irrelevant for small users |
| `getAccountByAddr(addr)` | Reverts **`AccountDoesNotExist(address)`** (selector `0x03a0e277`) when there is no account [V]. `getAccountById(bad)` → `AccountIdDoesNotExist(id)` [V] |
| `AccountInfo` | `balanceCNS` = free collateral. `lockedBalanceCNS` = locked by resting orders. `frozen` enum. `positions` = 4×256-bit bitmap (§5) [V] |

---

## 5. Positions, PnL and liquidation

`getPositionV2(perpId, accountId)` returns `(PositionInfoV2, markPricePNS, markPriceValid)`. **[V]**

| Field | Meaning |
|---|---|
| positionType | 0 long / 1 short. **An empty slot returns all zeros, so treat `lotLNS==0` as no position** [V] |
| depositCNS | Isolated collateral in this position (notional/leverage + collateralised negative PnL + top-ups) [V] |
| pricePNS + priceResiduePNSQ16 | Entry price. Longs store it rounded **up**. Effective entry = `(pricePNS − (long && residue>0 ? 1 : 0)) + residue/65536` [D] position.rs:242; reproduces `deltaPnlCNS` exactly [V] |
| lotLNS / entryBlock | Size / block opened |
| deltaPnlCNS | `side × (markPNS − entryPNS) × lotLNS × 10^(6−pd−ld)`, valued at the current mark [V] |
| premiumPnlCNS | Funding accrued (+ = received) [D]; seen nonzero on live accounts [V] |
| pnlCNS | = deltaPnlCNS + premiumPnlCNS. Checked on 4 live positions [V] |
| markPriceValid | **false when the mark is stale.** Use it as the UI "prices stale / opens disabled" flag [V] |

**Formulas (SDK `state/position.rs:128-150` and docs "Liquidation")** [D]:
- `MMR = entry × size / (maintFracHdths/100)`
- `liqPrice = entry + s × (MMR − deposit − premiumPnl) / size`, where s = +1 long and −1 short
- `bankruptcy = entry − s × (deposit + premiumPnl)/size`
- Example: account 1's BTC short gives liq ≈ $90,165. **[V]** arithmetic

**Which perps an account holds:**
- Read `getAccountByAddr(addr).positions`.
- Map the bits: bank1 bits 0..252 → perpId = bit. bank2 → 253+bit. bank3 → 509+bit. bank4 → 765+bit.
- **Bits 253-255 of bank1 are flags, not perps.** Account 1 has bit 253 set. **[V]** / SDK `state/account.rs:219`
- After our open: `bank1 = 65536 = 1<<16` → BTC. **[V]**

**History:**
- Exchange events are not indexed, so filter logs by `address + topic0` and decode the account id from data. **[V]**
- Alternatively use the authenticated REST history (§8).

---

## 6. Oracle / mark staleness (important for the fork)

- `refPriceMaxAgeSec = 60` on all 7 perps. **[V]**
- Price admins push mark and oracle roughly every few seconds (oracle: >0.1% move, or when within 10 s of max age). **[D]** (Price Indices)

Simulations (`eth_simulateV1` with block-time overrides on live testnet; state as-is on the fork) [V]:

| Operation, price stale (age ≥ ~60 s) | Result |
|---|---|
| Open / increase / flip, IOC | **REVERT** `MarkPriceAgeExceedsMax(perpId, markTs, now, 60)`. In some runs `TakerOrderSettlementFailed(perp, acct, …, resultCode=13)` [V] |
| Same via `execOrders(…, revertOnFail=false)` | **REVERT** (not skipped) [V] |
| CloseLong / CloseShort IOC | **OK**. It fills and `PositionClosed` is emitted [V] |
| IncreasePositionCollateral (type 5, `amountCNS`) | OK [V] |
| Post-only resting order | OK (`OrderPlaced`) [V] |
| deposit / withdraw / createAccount | OK [V] |
| Mark age 42 s | Open OK. Mark age 63 s: open reverts [V] |

**Fork (`127.0.0.1:8545`, forked at block 65176509):**
- Read-only checks: BTC `markAge 2008 s`, MON `1987 s`, `ignOracle=false`. **[V]**
- **Any open placed on the fork reverts `MarkPriceAgeExceedsMax`.** This fork went stale within about 1 min of forking. **[V]**

**Fork workaround.** I verified this only as `eth_simulateV1` against the fork. **Nothing was sent.** **[V]**
1. `anvil_impersonateAccount(0x582ea4aB…93B1)` (owner, a contract, so it needs `anvil_setBalance` for gas). Then call `setIgnOracle(perpId, true)` for each perp.
2. Keeper, every ≤ 45 s: impersonate price admin `0xd0b6c280…501d` and call `updateMarkPricePNS(perpId, uint32 livePNS)`, mirroring the real testnet mark.
   - With `ignOracle=true`, any mark is accepted (+10% tested). **[V]**
   - Without it, the call reverts `OracleAgeExceedsMax`. **[V]**
   - `updateMarkPricePNSByOwner` also works. **[V]**
3. After that, opens fill (BTC 0.001 at 839345 on the fork's frozen book), and 200 s later opens revert again while closes still work. **[V]**

Caveats for the fork:
- The fork's order book is frozen at fork time, with no market makers. Fills are against stale resting liquidity, which can diverge from the mirrored mark.
- Monad eth_simulateV1 quirks: no `validation:false`, the sender must be an EOA, and block numbers must strictly increase. **[V]**

---

## 7. Getting testnet AUSD

| Route | Status |
|---|---|
| `AUSD.mint` | Access-controlled. A random caller gets `AddressIsNotMinterRole()` (`0xdfcadb5b`). `batchMint` gets `AddressIsNotRole("MINTER_ROLE")`. `getMinterRoleMembers()` = [`0x99B0E95Fa8F5C3b86e4d78ED715B475cFCcf6E97`] (Agora EOA, also the AccessControlManager) [V] |
| Agora faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` | Listed for Monad Testnet in Agora "Contract Deployments" [D]. On-chain: proxy → impl `0xba804df5…2a49`, `token()`=AUSD, `faucetDripAmount` 10,000 AUSD, `maxDripFrequency` 60 s (a single global `lastDripTimestamp`), `maxAmountToOwn` 100,000 AUSD [V]. **`requestFunds(recipient)` currently reverts `InsufficientFunds()`**: the balance is exactly 10,000 AUSD and the last drip was ~5 h ago. With the faucet balance overridden it pays 10,000 AUSD, and a second call in the same block → `MaxFrequencyExceeded()` [V]. There is no web UI; call the contract directly. The Iris repo uses it this way [D] |
| Perpl docs / app | No faucet is mentioned. There is no faucet code in the testnet app bundle (46 chunks grepped). `/api/v1/faucet` is just the SPA fallback [V] |
| Ask a human | Perpl Discord `discord.gg/perpl` (from context `features.discordUrl`) or Agora, to refill the faucet or send AUSD [U] |
| Fork only | `anvil_setStorageAt(AUSD, keccak256(abi.encode(holder, 0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700)), balance << 8)`. Agora namespaced ERC-20 storage (`ERC20_CORE_STORAGE_SLOT()`). The low byte is the `isFrozen` flag. Allowance = `keccak256(abi.encode(spender, keccak256(abi.encode(owner, CORE+1))))` [V] (read back via `balanceOf`/`allowance` and used for the `createAccount` simulation) |

- `createAccount(100e6)` from an address with overridden balance and allowance → returns account id **694**. **[V]**
- 99.999999 AUSD → `InsufficentAmountToOpenAccount`. **[V]**
- Gas MON comes from faucet.monad.xyz. **[D]**

---

## 8. Public REST (base `https://testnet.perpl.xyz/api`, no auth)

| Path | What | Sample (live) |
|---|---|---|
| `GET /v1/pub/context` | Chain, instances, tokens, **markets with live state + config + last funding** | See below [V] |
| `GET /v1/market-data/:marketId/candles/:resSec/:fromMs-:toMs` | OHLCV, ≤1024 candles. res ∈ 60,300,900,1800,3600,7200,14400,28800,43200,86400 | `{"mt":12,"at":{"b":65173608,"t":…},"r":3600,"d":[{"t":1790193600000,"o":844803,"c":842663,"h":845281,"l":842370,"v":"164802631045","n":282},…]}`. Prices in PNS, `v` in CNS [V] |
| `GET /v1/market-data/:marketId/funding/:fromMs-:toMs` | Funding events (≤1024 intervals) | `{"mt":13,"m":16,"d":[{"at":{…},"feb":64899612,"rate":40,"idx":865103,"ppl":34,"sum":113958,"div":1},…]}` [V] |
| `GET /v1/market-data/funding/:fromMs-:toMs` | All markets, keyed by id (≤128 intervals) | `{"mt":13,"d":{"16":[…],"256":[…],…}}` [V] |
| `GET /v1/profile/announcements` | Announcements | `{"ver":252,"active":[]}` [V] |

`context.markets[i]` (BTC, abridged) [V]:

```json
{"id":16,"perpetual_id":16,"symbol":"BTC","funding_interval_sec":2580,"funding_interval_blocks":8571,
 "order_ttl_blocks":20,"order_max_market_slippage_bps":1000,"order_max_neg_pnl_collat_bps":1000,
 "config":{"is_open":true,"price_decimals":1,"size_decimals":5,"initial_margin":1500,"maintenance_margin":2500,
   "maker_fee":45,"taker_fee":345,"taker_fees":[345,300,250,210,175,150,125,0],"recycle_fee":"100000","contract_version":[1,7,5]},
 "state":{"at":{"b":65181968,"t":1790217775000},"orl":843206,"mrk":842551,"lst":842110,"mid":842107,"bid":842105,"ask":842110,
   "prv":864608,"dv":4364649,"dva":"3716083982673","oi":2091257,"tvl":"382438615890"},
 "funding":{"feb":65173884,"rate":40,"idx":840942,"ppl":33,"sum":114640,"div":1}}
```

Field meanings: `orl` oracle, `mrk` mark, `lst` last, `prv` = price 24h ago, `dv` = 24h volume in lots, `dva` = 24h volume in CNS (so $3.716M), `oi` in lots, `rate` in micros per interval. **[D]** (api-docs types.md)

Derived values:
- 24h change = `(mrk−prv)/prv`
- OI in USD = `oi/10^sd × mrk/10^pd`

`instances[0]` has `min_account_open_amount "100000000"`, `min_deposit_amount "10000000"` (UI only), and `min_withdraw_amount "10000"`. The context also has `geo_block: [BY,CU,GB,IR,KP,RU,SY,UA,US]`, which is API/UI-level; on-chain enforcement is [U].

**Account data:**
- `/v1/trading/{account-history,fills,order-history,position-history}` (and the undocumented `/v1/trading/positions`) return **401** without an Ed25519 API key. **[V]**
- Key enrollment needs a wallet EIP-712 signature, and the request `Origin` must be whitelisted by Perpl. **[D]**
- **For Juno, read positions and balances on-chain** (§4-5). No auth is needed.
- Live streams: WS `wss://testnet.perpl.xyz/ws/v1/market-data`, with `market-state@10143`, `funding@10143`, `order-book@16`, `trades@16`, `candles@16*3600`. **[D]**
- Public REST is limited to ~100 req/min. **[D]**

---

## 9. Error cheat-sheet (seen in simulation) [V]

| Error | Cause |
|---|---|
| `AccountDoesNotExist(addr)` | No account (reads, deposit) |
| `AccountExists` | createAccount twice |
| `InsufficentAmountToOpenAccount` | < 100 AUSD |
| `ERC20InsufficientAllowance` | Missing approve |
| `AmountExceedsAvailableBalance(amt, avail, bal)` | Withdraw too much |
| `MarkPriceAgeExceedsMax` / `TakerOrderSettlementFailed(…,13)` | Stale price, on open |
| `TakerOrderSettlementFailed(…,3)` | FOK can't be satisfied, or insufficient collateral [U on code meaning] |
| `ExceedsLastExecutionBlock` | Deadline passed |
| `PriceOutOfRange(p, min, max)` | Price outside base+1 … base+2^24−1 |
| `CloseOrderExceedsPosition`, `CloseOrderPositionMismatch`, `PositionDoesNotExist` | Bad close / type 5 without a position |

Full error ABI: `.juno/perpl/Errors.abi.json`. Decode against Exchange+Errors.

---

## 10. TypeScript (viem) snippet

- Type-checked with `tsc --strict`.
- Run against live testnet via `eth_simulateV1`. BTC open-long/close-long, MON open-long/close-long and ETH open-short/close-short all filled and closed flat. **[V]**
- `readPosition` reproduced the live account-1 positions.

```ts
// lib/perpl.ts - Perpl on Monad testnet (Exchange impl 0xbcbd3701…adbb, contract v1.7.5)
import { parseAbi, type Address, type PublicClient } from 'viem';

export const PERPL = {
  chainId: 10143,
  exchange: '0x1964C32f0bE608E7D29302AFF5E61268E72080cc' as Address,
  ausd: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC' as Address, // 6 decimals
  collateralDecimals: 6,
  api: 'https://testnet.perpl.xyz/api',
} as const;

/** On-chain OrderDescEnum (0-based). The REST/WS API numbers the same names from 1. */
export const OrderType = { OpenLong: 0, OpenShort: 1, CloseLong: 2, CloseShort: 3, Cancel: 4, IncreasePositionCollateral: 5, Change: 6 } as const;
/** On-chain PositionEnum. getPositionV2 returns positionType 0 for an EMPTY slot too: check lotLNS > 0. */
export const PositionType = { Long: 0, Short: 1 } as const;

export const perplAbi = parseAbi([
  'struct OrderDesc { uint256 orderDescId; uint256 perpId; uint8 orderType; uint256 orderId; uint256 pricePNS; uint256 lotLNS; uint256 expiryBlock; bool postOnly; bool fillOrKill; bool immediateOrCancel; uint256 maxMatches; uint256 leverageHdths; uint256 lastExecutionBlock; uint256 amountCNS; uint256 maxNegPnlCollatBPS; }',
  'struct OrderSignature { uint256 perpId; uint256 orderId; }',
  'struct PositionBitMap { uint256 bank1; uint256 bank2; uint256 bank3; uint256 bank4; }',
  'struct AccountInfo { uint256 accountId; uint256 balanceCNS; uint256 lockedBalanceCNS; uint8 frozen; address accountAddr; PositionBitMap positions; }',
  'struct PositionInfoV2 { uint256 accountId; uint256 nextNodeId; uint256 prevNodeId; uint8 positionType; uint256 depositCNS; uint256 pricePNS; uint256 lotLNS; uint256 entryBlock; int256 pnlCNS; int256 deltaPnlCNS; int256 premiumPnlCNS; uint256 priceResiduePNSQ16; }',
  'struct PerpetualInfoV2 { string name; string symbol; uint256 priceDecimals; uint256 lotDecimals; bytes32 linkFeedId; uint256 priceTolPer100K; uint256 marginTol; uint256 marginTolDecimals; uint256 refPriceMaxAgeSec; uint256 positionBalanceCNS; uint256 insuranceBalanceCNS; uint256 markPNS; uint256 markTimestamp; uint256 lastPNS; uint256 lastTimestamp; uint256 oraclePNS; uint256 oracleTimestampSec; uint256 longOpenInterestLNS; uint256 shortOpenInterestLNS; uint256 fundingStartBlock; int16 fundingRatePct100k; uint256 absFundingClampPctPer100K; uint8 status; uint256 basePricePNS; uint256 maxBidPriceONS; uint256 minBidPriceONS; uint256 maxAskPriceONS; uint256 minAskPriceONS; uint256 numOrders; bool ignOracle; uint256 fundingSumScalingExp; }',
  'function getPerpetualInfoV2(uint256 perpId) view returns (PerpetualInfoV2 perpetualInfo)',
  'function getMarginFractions(uint256 perpId, uint256 lotLNS) view returns (uint256 perpInitMarginFracHdths, uint256 perpMaintMarginFracHdths, uint256 dynamicInitMarginFracHdths, uint256 oiMaxLNS, uint256 unityDescentThreshHdths, uint256 overColDescentThreshHdths)',
  'function getAccountByAddr(address accountAddress) view returns (AccountInfo accountInfo)',
  'function getPositionV2(uint256 perpId, uint256 accountId) view returns (PositionInfoV2 positionInfo, uint256 markPricePNS, bool markPriceValid)',
  'function getMinAccountOpenCNS() view returns (uint256)',
  'function createAccount(uint256 amountCNS) returns (uint256 accountId)',
  'function depositCollateral(uint256 amountCNS)',
  'function withdrawCollateral(uint256 amountCNS)',
  'function execOrder(OrderDesc orderDesc) returns (OrderSignature signature)',
  'function execOrders(OrderDesc[] orderDescs, bool revertOnFail) returns (OrderSignature[] signatures)',
  // events (none indexed)
  'event AccountCreated(address account, uint256 id)',
  'event CollateralDeposit(uint256 accountId, uint256 amountCNS, uint256 balanceCNS)',
  'event CollateralWithdrawal(uint256 accountId, uint256 amountCNS, uint256 balanceCNS)',
  'event TakerOrderFilledV2(uint256 entryPricePNS, uint256 collatPricePNS, uint256 pnlPricePNS, uint256 lotLNS, uint256 feeCNS, int256 amountCNS, uint256 balanceCNS, uint256 builderId, uint256 builderFeeCNS)',
  'event ImmediateOrCancelExecuted(uint256 unmatchedLotLNS, uint256 totalLotLNS)',
  'event PositionOpenedV2(uint256 perpId, uint256 accountId, uint8 positionType, uint256 leverageHdths, uint256 depositCNS, int256 pnlCollateralizedCNS, uint256 pricePNS, uint256 lotLNS, uint256 insFeeCNS, uint256 protFeeCNS, uint256 priceResiduePNSQ16)',
  'event PositionIncreasedV2(uint256 perpId, uint256 accountId, uint8 positionType, uint256 leverageHdths, uint256 startDepositCNS, uint256 endDepositCNS, int256 pnlCollateralizedCNS, int256 premiumPnlSettledCNS, uint256 maxNegPnlCollatBPS, uint256 pricePNS, uint256 startLotLNS, uint256 endLotLNS, uint256 insFeeCNS, uint256 protFeeCNS, uint256 priceResiduePNSQ16)',
  'event PositionDecreased(uint256 perpId, uint256 accountId, uint8 positionType, uint256 startDepositCNS, uint256 endDepositCNS, uint256 startLotLNS, uint256 endLotLNS, int256 deltaPnlCNS, int256 fundingCNS)',
  'event PositionClosed(uint256 perpId, uint256 accountId, uint8 positionType, uint256 pricePNS, int256 deltaPnlCNS, int256 fundingCNS)',
  // errors worth decoding in the UI
  'error AccountDoesNotExist(address accountAddress)',
  'error AccountExists(address sender, uint256 accountId)',
  'error InsufficentAmountToOpenAccount(address sender, uint256 amountCNS)',
  'error AmountExceedsAvailableBalance(uint256 amountCNS, uint256 availableBalanceCNS, uint256 balanceCNS)',
  'error TakerOrderSettlementFailed(uint256 perpId, uint256 accountId, uint256 entryPricePNS, uint256 collatPricePNS, uint256 pnlPricePNS, uint256 filledLotLNS, uint256 unfillableLotLNS, uint256 resultCode)',
  'error MarkPriceAgeExceedsMax(uint256 perpId, uint256 markTimestamp, uint256 timestamp, uint256 maxAgeSec)',
  'error OracleAgeExceedsMax(uint256 perpId, uint256 oracleTimestamp, uint256 timestamp, uint256 maxAgeSec)',
  'error ExceedsLastExecutionBlock(uint256 lastExecutionBlock)',
  'error PriceOutOfRange(uint256 pricePNS, uint256 minPricePNS, uint256 maxPricePNS)',
  'error CloseOrderExceedsPosition(uint256 posLotLNS, uint256 orderLotLNS)',
  'error CloseOrderPositionMismatch(uint8 positionType, uint8 orderType)',
  'error PositionDoesNotExist(uint256 perpId, uint256 accountId)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
]);

const pow10 = (n: number) => 10n ** BigInt(n);

/** Exact decimal string -> scaled integer. Throws rather than truncating (the contract truncates silently). */
export function toUnits(human: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(human.trim());
  if (!m) throw new Error(`not a decimal: ${human}`);
  const frac = (m[2] ?? '').replace(/0+$/, '');
  if (frac.length > decimals) throw new Error(`${human} has more than ${decimals} decimal places`);
  return BigInt(m[1]) * pow10(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}
export const fromUnits = (v: bigint, decimals: number) => Number(v) / 10 ** decimals; // display only

export type PerpMeta = {
  perpId: bigint; symbol: string;
  priceDecimals: number; lotDecimals: number;
  basePricePNS: bigint; minPNS: bigint; maxPNS: bigint;
  markPNS: bigint; markTimestamp: bigint; oracleTimestampSec: bigint; maxAgeSec: bigint; ignOracle: boolean;
  maxLeverageHdths: bigint; // perpInitMarginFracHdths: 1500 = 15x
  maintFracHdths: bigint;   // perpMaintMarginFracHdths: 2500 -> MMR = notional/25 = 4%
};

export async function loadPerp(client: PublicClient, perpId: bigint): Promise<PerpMeta> {
  const [info, mf] = await Promise.all([
    client.readContract({ address: PERPL.exchange, abi: perplAbi, functionName: 'getPerpetualInfoV2', args: [perpId] }),
    client.readContract({ address: PERPL.exchange, abi: perplAbi, functionName: 'getMarginFractions', args: [perpId, 0n] }),
  ]);
  return {
    perpId, symbol: info.symbol,
    priceDecimals: Number(info.priceDecimals), lotDecimals: Number(info.lotDecimals),
    basePricePNS: info.basePricePNS,
    minPNS: info.basePricePNS + 1n,               // below -> PriceOutOfRange
    maxPNS: info.basePricePNS + (1n << 24n) - 1n, // 2^24 price levels above base
    markPNS: info.markPNS, markTimestamp: info.markTimestamp, oracleTimestampSec: info.oracleTimestampSec,
    maxAgeSec: info.refPriceMaxAgeSec, ignOracle: info.ignOracle,
    maxLeverageHdths: mf[0], maintFracHdths: mf[1],
  };
}

/** Opens/increases revert once mark (or oracle, unless ignOracle) is >= maxAgeSec old. Closes still work. */
export function openBlockedByStalePrice(perp: PerpMeta, blockTimestamp: bigint): boolean {
  const markStale = blockTimestamp - perp.markTimestamp >= perp.maxAgeSec;
  const oracleStale = !perp.ignOracle && blockTimestamp - perp.oracleTimestampSec >= perp.maxAgeSec;
  return markStale || oracleStale;
}

export type MarketOrderArgs = {
  perp: PerpMeta;
  side: 'long' | 'short';
  action: 'open' | 'close';
  lotLNS: bigint;              // open: toUnits(size, perp.lotDecimals); close-all: position.lotLNS
  slippageBps: number;         // worst price = ref * (1 ± bps/10_000)
  leverage?: string;           // "5", "2.5"; ignored for closes. Omitted -> perp max.
  refPricePNS?: bigint;        // default mark; best ask/bid is a tighter reference
  headBlock: bigint;           // current block number
  ttlBlocks?: bigint;          // lastExecutionBlock = head + ttl (~0.4 s/block). 0n = no deadline.
  orderDescId?: bigint;        // free-form client id for direct calls
  maxMatches?: bigint;         // 1..1000 (0 = contract max 1000)
  maxNegPnlCollatBPS?: bigint; // extra collateral allowed for fill-vs-mark loss, bps of notional
};

/** Marketable-limit IOC - what the Perpl app calls a market order. */
export function buildMarketOrder(a: MarketOrderArgs) {
  const isBuy = (a.side === 'long') === (a.action === 'open'); // open long / close short lift asks
  const orderType = a.action === 'open'
    ? (a.side === 'long' ? OrderType.OpenLong : OrderType.OpenShort)
    : (a.side === 'long' ? OrderType.CloseLong : OrderType.CloseShort);
  const ref = a.refPricePNS ?? a.perp.markPNS;
  const bps = BigInt(Math.round(a.slippageBps));
  let pricePNS = isBuy ? (ref * (10_000n + bps) + 9_999n) / 10_000n : (ref * (10_000n - bps)) / 10_000n;
  if (pricePNS < a.perp.minPNS) pricePNS = a.perp.minPNS;
  if (pricePNS > a.perp.maxPNS) pricePNS = a.perp.maxPNS;
  let leverageHdths = a.leverage ? toUnits(a.leverage, 2) : a.perp.maxLeverageHdths;
  if (leverageHdths > a.perp.maxLeverageHdths) leverageHdths = a.perp.maxLeverageHdths; // contract clamps anyway
  if (a.lotLNS <= 0n) throw new Error('size rounds to 0 lots');
  const ttl = a.ttlBlocks ?? 100n;
  return {
    orderDescId: a.orderDescId ?? BigInt(Date.now()),
    perpId: a.perp.perpId,
    orderType,
    orderId: 0n,
    pricePNS,
    lotLNS: a.lotLNS,
    expiryBlock: 0n,            // IOC never rests
    postOnly: false,
    fillOrKill: false,          // true = all-or-revert
    immediateOrCancel: true,
    maxMatches: a.maxMatches ?? 100n,
    leverageHdths,
    lastExecutionBlock: ttl === 0n ? 0n : a.headBlock + ttl,
    amountCNS: 0n,              // only IncreasePositionCollateral uses it; opens take notional/leverage
    maxNegPnlCollatBPS: a.maxNegPnlCollatBPS ?? 1000n,
  } as const;
}

export const openLongIOC = (perp: PerpMeta, size: string, leverage: string, slippageBps: number, headBlock: bigint) =>
  buildMarketOrder({ perp, side: 'long', action: 'open', lotLNS: toUnits(size, perp.lotDecimals), leverage, slippageBps, headBlock });

export const closeLongIOC = (perp: PerpMeta, positionLotLNS: bigint, slippageBps: number, headBlock: bigint) =>
  buildMarketOrder({ perp, side: 'long', action: 'close', lotLNS: positionLotLNS, slippageBps, headBlock });

/** Perp IDs with a position, from getAccountByAddr(...).positions (bank1 bits 253-255 are flags). */
export function perpsWithPositions(p: { bank1: bigint; bank2: bigint; bank3: bigint; bank4: bigint }): bigint[] {
  const out: bigint[] = [];
  for (const [offset, bits, bank] of [[0n, 253, p.bank1], [253n, 256, p.bank2], [509n, 256, p.bank3], [765n, 256, p.bank4]] as const)
    for (let i = 0; i < bits; i++) if ((bank >> BigInt(i)) & 1n) out.push(offset + BigInt(i));
  return out;
}

export async function readPosition(client: PublicClient, perp: PerpMeta, accountId: bigint) {
  const [p, markPNS, markValid] = await client.readContract({
    address: PERPL.exchange, abi: perplAbi, functionName: 'getPositionV2', args: [perp.perpId, accountId],
  });
  if (p.lotLNS === 0n) return null;
  const isLong = p.positionType === PositionType.Long;
  const pd = perp.priceDecimals, cd = PERPL.collateralDecimals;
  const entryPNS = p.priceResiduePNSQ16 === 0n // long entry is stored rounded up; residue is 16-bit
    ? Number(p.pricePNS)
    : Number(isLong && p.pricePNS >= 1n ? p.pricePNS - 1n : p.pricePNS) + Number(p.priceResiduePNSQ16) / 65536;
  const entry = entryPNS / 10 ** pd;
  const size = fromUnits(p.lotLNS, perp.lotDecimals);
  const mark = fromUnits(markPNS, pd);
  const deposit = fromUnits(p.depositCNS, cd);
  const premium = Number(p.premiumPnlCNS) / 10 ** cd; // funding accrued (+ = received)
  const uPnl = Number(p.pnlCNS) / 10 ** cd;           // deltaPnl + premiumPnl, at mark
  const mmr = (entry * size) / (Number(perp.maintFracHdths) / 100);
  const s = isLong ? 1 : -1;
  const liquidationPrice = Math.max(0, entry + (s * (mmr - deposit - premium)) / size); // SDK formula
  return { side: isLong ? 'long' : 'short', lotLNS: p.lotLNS, size, entry, mark, markValid,
    deposit, uPnl, premium, equity: deposit + uPnl, liquidationPrice, effectiveLeverage: (mark * size) / (deposit + uPnl) };
}
```

Usage sketch (wallet client from Privy etc.):

```ts
const perp = await loadPerp(publicClient, 16n);
const head = await publicClient.getBlock();
if (openBlockedByStalePrice(perp, head.timestamp)) throw new Error('Perpl prices stale - opens disabled');
// one-time: approve + createAccount(>= getMinAccountOpenCNS()); later deposits: depositCollateral
const desc = openLongIOC(perp, '0.001', '5', 100 /* 1% */, head.number);
const gas = await publicClient.estimateContractGas({ account, address: PERPL.exchange, abi: perplAbi, functionName: 'execOrder', args: [desc] });
const hash = await walletClient.writeContract({ account, address: PERPL.exchange, abi: perplAbi, functionName: 'execOrder', args: [desc], gas: (gas * 12n) / 10n });
// receipt: decode logs with perplAbi -> PositionOpenedV2 / TakerOrderFilledV2, or ImmediateOrCancelExecuted (nothing filled)
// close: const pos = await readPosition(publicClient, perp, accountId); closeLongIOC(perp, pos!.lotLNS, 100, head.number)
```

---

## Appendix: how the simulations were done (reproducible, read-only)

- `eth_simulateV1` on `https://testnet-rpc.monad.xyz`, with `stateOverrides` on AUSD giving a fresh EOA 1,000 AUSD (slot formula §7).
- Calls run in sequence: approve → createAccount → execOrder → getPositionV2 → execOrder(close). `blockOverrides.time` shifts the clock for the staleness tests.
- The same method was run against the anvil fork. On the fork I also simulated owner and price-admin calls; anvil allows a contract sender.
- No transactions were sent to testnet or to the fork, and the fork was not restarted. I confirmed fork state was unchanged afterwards: `ignOracle=false`, mark still stale.
- The scripts (`simflow.mjs`, `simstale*.mjs`, `simfork*.mjs`, `tstest/`) were in the session scratchpad. They are not committed.
