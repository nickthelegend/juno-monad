# Juno: sponsor technology audit, and 250 ranked ideas

Written 2026-09-24 for Monad Metropolis. The build window closes 13 Oct 2026 and judging runs 14–27 Oct. The sponsors covered are the ones the team picked: **Kuru, Envio, Privy, Nansen and Monad itself.**

**Sources.**
- **The research files:** [`research/research-kuru.md`](research/research-kuru.md) is cited as [K], [`research/research-privy-nansen.md`](research/research-privy-nansen.md) as [PN], and [`research/research-monad-envio.md`](research/research-monad-envio.md) as [ME]. Each one tags its own claims as verified, from docs, or unverified.
- **The repo:** HEAD `c979a92`, plus the uncommitted working tree. `contracts/src/JunoLaunchpad.sol` was being edited while this was written, so its line numbers are a snapshot.
- **A live verification run** of the app, described below.

Every `file:line` below was checked with `grep -n` against that tree.

**Verdicts, strictly defined.**
- **GENUINELY USED**: a code path runs and has been exercised end to end.
- **IMPORTED BUT UNUSED**: a dependency or export exists, but nothing calls it.
- **FAKED**: the UI claims something the code does not do.
- **MISSING**: nothing is there.

**One caveat governs everything below.** Nothing is deployed to real Monad testnet yet. The operator wallet `0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC` is waiting for faucet MON.
- The live verification ran on a local **anvil fork of Monad testnet**: chain 10143, with real forked state for Pyth, USDC and WMON.
- It went through the real Expo web app in Chrome, with real Pinata IPFS.
- It covered: wallet creation, faucet, EIP-191 name claim, photo launch, buy with comment, sell, chart, fill-the-curve (partial fill and refund), graduation into a real Uniswap v2 pair at the pre-locked CREATE2 address (LP to `0xdEaD`), and a creator fee claim.
- So "GENUINELY USED" below means **on the fork** unless it says "real testnet".
- The official rules want judges to be able to verify what was built. Contract addresses and transaction hashes on a real network are the entry ticket for every bounty here [ME §1].

---

## 1. Honest status

### Re-verified live, 2026-09-24 (second run, after a restart)

The stack was rebuilt from nothing: a fresh anvil fork of Monad testnet at block 65,197,097, Juno redeployed to it (launchpad `0x43cA…0A075`, Kuru graduator `0x9d13…CFa70`), the Envio indexer, the API and the Expo web build. Each sponsor was then exercised again and the network traffic read, not assumed.

| Sponsor | Verdict | What was run | What came back |
|---|---|---|---|
| **Monad** | **GENUINELY USED.** Reads and the commit-state stream are on **real testnet**; writes are on the fork | `GET /api/juno/live`; a 2 MON Kuru buy through the trade sheet in Chrome | `connected: true` to `wss://testnet-rpc.monad.xyz`, with a `lastMessageAt` seconds old. The buy landed (`0xef8d…56c6`) and the sheet said *"confirmed on a local fork of Monad testnet in 0.8s"* |
| **Kuru** | **GENUINELY USED**, against Kuru's **real testnet contracts** on the fork | Launch KURU410 with venue Kuru → fill → graduate → buy (script), then `Router.verifiedMarket(market)`; then the buy in Chrome | Market `0xE484…3b14` is registered in Kuru's own Router (base = the token, precision 1e7). The scripted buy `0xee30…e77e` has status 1 and logs from the market and the token. A USDC launch asking for Kuru is refused with 400. The Chrome buy got 39,880 tokens at the book's 0.00005 MON ask |
| **Envio** | **GENUINELY USED** on the fork | GraphQL on `:8080` | `KuruMarket 0xE484…3b14` with `tradeCount 3` (2 buys, 1 sell), and three `KuruTrade` rows whose hashes match the three transactions above, including the Chrome buy from `0xE0fC…A981` |
| **Privy** | **GENUINELY USED on web; a login has still not been completed** | The web build in Chrome, reading the page's resource timing; the verify route with a bad token | `GET https://auth.privy.io/api/v1/apps/cmrmdbnfo00lw0djscwztkeuh` → 200 and Privy's embedded-wallets iframe loaded. `POST /api/juno/profiles/privy` → 401. No one has logged in: that needs a person's email or social account |
| **Nansen** | **MISSING** | `grep -ril nansen lib app juno-expo indexer/src contracts/src` → no matches. An unauthenticated `POST https://api.nansen.ai/api/v1/profiler/address/pnl-summary` | HTTP **402** with `x402Version: 2` and 8 ways to pay (Base, X Layer, BSC…). It needs an API key or real USDC, so nothing was built on guesswork |

**Fixed in this pass.** The one misleading line this audit found is gone. `GET config` now reports `localFork` when the server's own RPC is on its machine (`lib/juno/network.ts` `localFork`, `app/api/juno/config/route.ts`), and the trade sheet credits the fork instead of Monad with the time it measured (`juno-expo/components/TradeSheet.tsx`). On real testnet the sentence reads "confirmed on Monad" again.

**Built since the first run of this audit, and marked "Built" in the lists below.**
- Kuru: #1, 2, 4, 5, 6, 7, 8, 10, 11, 18, 19, 20 and 27 are built. #23 is partly built (bid and ask on the coin page, not yet on feed cards). Limit orders shipped as "Your orders on Kuru" on the coin page: place, cancel, and withdraw what filled.
- Perpl, the perps the team asked for: #46–48 are partly built. Perps on Perpl's seven testnet markets (BTC, ETH, SOL, MON, ZEC, LIT, PUMP) run from the Trade tab against its testnet exchange; trading was exercised on the fork, with funded AUSD. There is no builder code yet.
- Envio: #2, 4 and 38 are built; #3 is built for Kuru only (Uniswap pairs are not indexed); #6 is built on the holders tab only.
- Privy: #9 and #12 are built, and #1 is built on web only.
- Nansen and Monad: nothing new.

The original findings follow. Where a later update changed a finding, the update is dated in the text.


| Sponsor | Verdict | How deep | Where it is (file:line or flow) | What is absent |
|---|---|---|---|---|
| **Monad** | **GENUINELY USED** on the fork. The commit-state stream was verified against **real testnet** block heads | Deep in the transaction pipeline and the UX. Shallow in the contracts: no Monad-only opcode, precompile or storage layout | chain `lib/juno/network.ts:2,33`; Multicall3 batching `lib/juno/client.ts:25`; gas estimate + 7.5% `lib/juno/tx.ts:74,153-155`; `eth_sendRawTransactionSync` + `confirmedInMs` `lib/juno/tx.ts:402,436,467`, shown at `juno-expo/components/TradeSheet.tsx:504-507`; 100-block `getLogs` handling `lib/juno/swaps.ts:152,191,221`; reserve balance `app/api/juno/faucet/route.ts:39,206`, `TradeSheet.tsx:64-74`, `tx.ts:616`; 3-block settle `faucet/route.ts:55`; Pyth `lib/juno/pyth.ts:58,150`; commit states `lib/juno/live.ts:25,194,196` + `app/api/juno/live/route.ts:23` → `LiveTape.tsx:21` (used at `app/(tabs)/social.tsx:222`) and `Finality.tsx:13` (used at `TradeSheet.tsx:511`); counterfactual CREATE2 pair `contracts/src/graduators/UniswapV2Graduator.sol:63` | Real deployment. P256VERIFY/passkeys (Mera). EIP-7702. Staking precompile. `dippedIntoReserve`. MIP-8 page layout. Foundry ≥1.8 `--network monad` is wired in `contracts/deploy.sh:121-127` but has **never run**, because local forge is 1.7.1 |
| **Envio** | **GENUINELY USED** on the fork | Medium. HyperIndex 3.12.1 runs, and the app reads it for 4 features | `indexer/config.yaml:25-53,67-69`; dynamic token registration `indexer/src/EventHandlers.ts:119-120`; Effect API `indexer/src/quotes.ts:39-45`; app reads `lib/juno/envio.ts:69,106,130,158` → `swaps.ts:312-313`, `activity.ts:93-102` (labelled at `juno-expo/app/coin/[token].tsx:770`), `chain.ts:278-281`, `portfolio.ts:308-309,376` | Real testnet, Envio Cloud, HyperSync/HyperRPC, post-graduation Uniswap pair indexing, candles, subscriptions. **Updated 2026-09-24:** the leaderboard now reads every indexed fill (`lib/juno/leaderboard.ts` `indexedHistories`), `envioStatus` drives the holders tab's freshness line, and the indexer follows each Kuru market and order (`KuruMarket`, `KuruTrade`, `KuruOrder`) with one cost basis across graduation |
| **Kuru** | **GENUINELY USED** on the fork against Kuru's **real testnet contracts** (updated 2026-09-24, after this audit was first written) | Deep for one feature: graduation into Kuru and trading there afterwards, with market **and limit** orders (`lib/juno/kuru.ts` `buildKuruLimitOrder`, `buildKuruCancel`, `buildKuruWithdraw`; `juno-expo/components/KuruOrders.tsx`). No forwarder or Flow | Venue choice `contracts/src/JunoLaunchpad.sol:257,461`; `contracts/src/graduators/KuruGraduator.sol:86` (`prepare` locks `MarginAccount`), `:97-143` (`computeAddress` → reuse or `deployProxy` → `vault.deposit` to `0xdEaD`), `:168` (market params per Kuru's SDK); deploy `contracts/script/Deploy.s.sol:189`; free quotes and market orders `lib/juno/kuru.ts:125,165,235` → `lib/juno/tx.ts:228,282`, fills read from receipts `tx.ts:607`; indexer follows each market `indexer/config.yaml:58-67`, `indexer/src/EventHandlers.ts:387,416`; app `juno-expo/app/(tabs)/post.tsx:362` (venue picker), `juno-expo/app/coin/[token].tsx:119` (book, market link, Buy after graduation), `juno-expo/components/TradeSheet.tsx:189`. Tests: `contracts/test/KuruGraduator.t.sol` (3 unit + 6 fork tests against live Kuru testnet state). Verified in the app on the fork: launch → fill → graduate → buy 2 MON → sell 19,940 tokens | Real testnet deployment (deployer unfunded). `KuruForwarder` (conditional orders), depth chart. Mainnet (owner-only market creation). **No perps: Kuru has none** |
| **Privy** | **GENUINELY USED on the web build; login not yet exercised by us** (updated 2026-09-24) | Medium: a signer, not just a login | `juno-expo/lib/privy.web.tsx` (PrivyProvider; a `SignerSource` that hands Juno's server-built transactions to `useSignTransaction`), `juno-expo/lib/wallet-choice.tsx` (device key or Privy, chosen on the profile), `lib/juno/privy.ts` + `app/api/juno/profiles/privy/route.ts` (`@privy-io/node` verifies the session and records the X handle only for a wallet the Privy user owns). Verified: provider loads on `http://localhost:3000`, the login modal opens with email/Google/X, the route answers 401 to a bad token | A completed login and a Privy-signed transaction (needs a person). Native (`@privy-io/expo`, dev build). Gas sponsorship, server signers and policies (dashboard) |
| **Nansen** | **MISSING** | None | None. No key or code; only the idea at `docs/METROPOLIS.md:42` | Everything. The idea on record, "smart money is buying this reel", is **impossible** (no testnet data) and **prohibited** (public smart-money labels) |

No **FAKED** feature was found. One piece of copy was misleading on the fork: the trade sheet printed "confirmed on Monad in 0.8s" when `confirmedInMs` measured anvil. **Fixed 2026-09-24:** on a fork it now says "confirmed on a local fork of Monad testnet". **Still, do not record the demo on the fork.**

### Monad: the one sponsor with runtime evidence
**What Juno does well:**
- It treats Monad as a different chain rather than "an EVM":
  - It pays attention to the gas limit being charged in full.
  - It submits with `eth_sendRawTransactionSync` and times it.
  - It handles the 100-block `eth_getLogs` cap with receipt recording plus a cursor.
  - Faucet spacing and trade-sheet copy account for the 10 MON reserve balance.
  - The faucet waits 3 blocks before it answers.
  - One server-side WebSocket subscribes to `monadNewHeads` and `monadLogs`, and the phone renders Proposed → Voted → Finalized.
- Against real testnet, the stream measured Proposed→Voted in about 80 ms and →Finalized in about 290 ms.

**Three things to be strict about:**
1. **The live tape has never shown a Juno trade on real testnet.** The launchpad is not there, so the `monadLogs {address: launchpad}` filter (`live.ts:196`) matches nothing. My inference from the setup is that an anvil fork serves no `monad*` subscriptions, so no fork trade could have had its stages streamed either.
2. **The 2.06M launch gas was measured with Ethereum gas rules.** Foundry 1.7.1 uses them. Monad's MIP-8 pricing differs (a cold page SLOAD costs 8,100), and Monad charges the gas limit [ME §2.4]. Re-measure.
3. **The contracts are generic EVM.** Everything Monad-native lives in the TypeScript. That is fine for "Monad Integration (20%)" only if the write-up states why each piece exists.

### Envio: real, useful, not yet provable
**On the fork:**
- The indexer runs in RPC mode: `rpc: for: ${ENVIO_TESTNET_RPC_FOR}`, `config.yaml:67-69`, so no HyperSync token is needed.
- It registers every launched token for `Transfer` indexing.
- The app reads it for four things:
  - trade history
  - complete holders, including transfer recipients
  - holder counts
  - the whole portfolio from `Position`

**That is a genuine "core feature" dependency.** Holders and portfolio are measurably better with Envio than without it.

**Gaps a judge would notice:**
- No public GraphQL endpoint. Envio Cloud is not deployed, and nothing runs on real testnet.
- ~~The freshness function `envioStatus` is written but unwired.~~ Wired 2026-09-24: the holders tab says how current the indexer is.
- ~~The leaderboard still rebuilds itself pool by pool.~~ Fixed 2026-09-24: it reads every indexed fill.
- Price and P&L freeze at graduation into **Uniswap**, because the pair is not indexed. Kuru markets are indexed, so a Kuru coin's P&L carries on.
- The indexer does not know about the `GraduatorAllowed` event.

**Docs drift:** `JUNO.md:40` still lists "Holders beyond traders" as not built, but it is built (`activity.ts:93-102`).

### Kuru: built for graduation and trading, and the perps plan needs correcting
- **Kuru has no perps.** It has no perpetuals, leverage, funding, liquidation or oracle.
  - `MarginAccount` and `_isMargin` mean "trade from your deposited balance".
  - Kuru's own v2 SDK says: *"Perps are intentionally not exposed in v1."* [K §1.1] (https://github.com/Kuru-Labs/ts-sdk/blob/main/docs/architecture.md)
  - What Kuru has: a spot CLOB with an AMM vault per market, a meta-transaction forwarder with price-triggered orders, the Flow aggregator (mainnet only), and data APIs (mainnet only).
- **Perps on Monad means Perpl.** Perpl is a separate sponsor ($5k API + $3k analytics), and it is also Track 01 only [K §1.2].
- **Where the Kuru work stands (updated 2026-09-24):**
  - Built: a creator picks Uniswap v2 or Kuru at launch; `KuruGraduator` opens a Kuru market at the curve's final price and burns the vault shares; the app quotes and trades graduated coins on their Kuru market; Envio indexes every market Juno opens.
  - Verified: 6 fork tests against Kuru's live testnet contracts, and the whole lifecycle through the API and the web app on the fork. The market opened with its ask at exactly the curve's final price (0.00005 MON), and the bid one 1% spread below it.
  - Not yet: a real testnet deployment (the deployer has no MON), limit orders and conditional orders.
  - On mainnet, market creation reverts `Unauthorized()` for everyone except Kuru's 3-of-5 Safe [K §3.1], so the deploy script only offers Kuru on testnet.

### Privy: a web signer and verified identities, login still to be run (updated 2026-09-24)

**Update.** The web build now signs with a Privy embedded wallet when the person chooses it on their profile, and the server verifies a Privy session to show a creator's linked X handle. See the status table. What follows was written before that and is kept for the native plan.

- **The seam is well placed.** `Signer`/`SignerSource` in `wallet.tsx`, and `WalletMode` already names `"privy"`. The research confirmed that Privy's Expo `eth_signTransaction` signs Juno's server-built EIP-1559 fields as given [PN §1.2].
- **But nothing is wired.**
  - The package added to the app, `@privy-io/react-auth`, is the **web** SDK. Native iOS/Android needs `@privy-io/expo` and an Expo development build.
  - The Privy dashboard app that exists is named **"norr"**. It has email/Google/Twitter/wallet login and allowed domains `http://localhost:3000`, `http://localhost` and `https://norr.fun`.
  - It has **no native app identifiers**. Juno's would be `fun.juno.app` (`juno-expo/app.json:11,21`) with URL scheme `juno` (`app.json:40`).
  - Its wallet mode reads "user-controlled-server-wallets-only". That looks like TEE execution, which sponsorship, signers and policies all require. Confirm it under Wallets → Advanced **[unverified mapping]**.
- **The bounty disqualifies login-only integrations** [PN §1.4].

### Nansen: missing, and the recorded idea cannot ship
- **No data exists for Juno's tokens or wallets.** Nansen has no testnet anywhere in its OpenAPI spec, so none of Juno's testnet tokens or wallets will ever appear in Nansen [PN §2.2].
- **Displaying smart-money data publicly is prohibited.** That covers `address/labels`, `smart-money/holdings` and `smart-money/dex-trades` (https://docs.nansen.ai/guides/redistribution-guide).
- So `docs/METROPOLIS.md:42`'s "Smart money is buying this reel" fails twice: there is nothing to show, and showing it would break the rules.
- **The honest version** hangs on a *linked mainnet wallet*: a composite "proven trader" score built from allowed inputs (`pnl-summary`, balances, Points tier) plus Juno's own data [PN §2.5].
- **Paying per call** with x402 in USDC on Monad mainnet exists ($0.01 per basic call). It needs **real mainnet USDC**, which is the team's money and the team's decision.

### Track locks and the Kuru plan

Bounties are locked to the primary track on the platform (`docs/METROPOLIS.md:33-34`). `README.md:13` says **Track 03**.

| Bounty | Prize | Reachable from Track 03? | Reachable from Track 01? | Notes |
|---|---|---|---|---|
| Kuru: Consumer Trading App | $5k | **No** | Yes | No public criteria. A participant's copy [K §5, unverified]: "working focused spot product routing through Kuru onchain order book … evidence of demand through usage/trading activity" |
| Kuru: New Assets and Markets | $5k | **No** | Yes | Literal fit: every graduated post becomes a new Kuru market. Testnet only unless Kuru's Safe deploys or allowlists |
| Perpl: API $5k, Analytics/Risk $3k | $8k | **No** | Yes | A separate sponsor, not Kuru. Fixed majors only; post-tokens cannot get perps |
| Agora: Best Mobile Trading App | $10k | **No** | Yes | Per the team's notes, requires Mera login, an AUSD balance and a Perpl trade (`docs/METROPOLIS.md:62-63`, unverified). **Mera conflicts with the Privy bounty** [ME §1] |
| Envio, Privy, Nansen | $1k, $5k, $5k pool | Yes | Yes | All tracks |
| Mera ×2 | $2.5k each | Yes (all tracks, unverified) | Yes | Mutually exclusive with Privy/Dynamic, per a participant [ME §1, unverified] |
| Hunyuan | $2k credits | Yes | **No** | Social track only |

**The tension.** "We will implement Kuru's perps and trading" has two problems. There are no Kuru perps. And even Kuru's spot bounties cannot be claimed from Track 03. **The team has to decide:**

- **Stay on Track 03.**
  - For: Juno is close to a literal reading of the track's own examples ("a feed where curation is paid for by the people who benefit from it"), and the Envio/Privy/Nansen stack is all-tracks.
  - What Kuru becomes: a graduation venue and post-graduation trading. It is a real product feature that also strengthens "Monad integration" through ecosystem composability, **but it wins no Kuru prize**. Budget it accordingly: build it after Privy and Envio are demo-ready.
- **Switch to Track 01.**
  - For: it unlocks Kuru $10k and Perpl $8k, and Agora $10k if the team goes Mera instead of Privy.
  - Against:
    - The rules define Track 01's primary user as "a trader, protocol, or financial product builder", which is a weaker fit for a social app.
    - Kuru's reported criteria ask for real usage and trading activity, and all of Juno's is testnet.
    - Kuru v1 testnet is unmaintained: its MON/USDC market has one stale ask [K §2.1].
    - Mainnet listing needs Kuru's team.
    - Hunyuan is lost.
  - If the team switches, "Bring New Assets and Markets to Kuru" is the stronger of the two Kuru bounties for Juno.
- **Either way.**
  - Ask Kuru's CEO (a listed mentor) for the judging criteria, and for a mainnet market or a graduator allowlist [K §5].
  - Do not present anything as "Kuru perps".

---

## 2. Kuru

### 2.1 What Kuru offers
Sources: https://docs.kuru.io/llms-full.txt, https://docs.kuru.io/contracts/Contract-addresses, https://github.com/Kuru-Labs/Kuru-contracts-dex-public, https://github.com/Kuru-Labs/kuru-sdk, https://docs.kuru.io/kuru-flow/flow-overview.

- **Spot CLOB v1, live on mainnet and testnet** [K §2]. There is one `OrderBook` per market:
  - market orders: `placeAndExecuteMarketBuy/Sell`, with IOC or FOK
  - limit and post-only orders: `addBuyOrder/addSellOrder`, `batchUpdate`
  - flip orders: `addFlipBuyOrder`, `batchProvisionLiquidity`
  - reads: `bestBidAsk`, `getL2Book`, `getVaultParams`
- **The other contracts:**
  - `MarginAccount`: deposit, withdraw, and claiming fills with `batchWithdrawMaxTokens`.
  - `KuruAMMVault`: ERC-20 LP shares. The deployed `deposit` takes 4 arguments.
  - `Router`: `deployProxy`, `computeAddress`, `anyToAnySwap` and `verifiedMarket`.
  - `KuruForwarder`: EIP-712 `execute` and `executePriceDependent`, for stop and take-profit orders.
  - `MonadDeployer`.
- **Testnet addresses:**
  - Router `0x7EFbE105Ca7415dE98F96622173458ac1c054630`
  - MarginAccount `0xd029C2D98ff85D8F64799017fE00a59B1159CE02`
  - Forwarder `0x681bB1508E14433b148a2549ba2726454aDc9BB4`
  - MonadDeployer `0xDacd06372cEb638640c9D8466A023b7362324e1A`
- **Free, exact quotes.** An `eth_call` from `address(0)` to a market-order function matches without moving funds and returns the output, vault included [K §2.4].
- **Market creation** [K §3.1]:
  - Testnet: open to anyone (about 1.08M gas).
  - Mainnet: reverts `Unauthorized()` for all but the owner Safe `0x8B736DCe2071783Fd9DB0a423dad17cc8ed5788b`.
  - Kuru v2's `SpotRouter.deploySpotMarket` is permissioned even on testnet.
- **The graduation simulation on testnet** [K §3.3]:
  - Steps: lock, then `deployProxy(2, token, 0x0, 1e8, 1e8, 5, 1e11, 1e14, 30, 10, 100)`, then `vault.deposit{value}(base, quote, quote, 0xdEaD)`.
  - Result: the ask opened at **5.000e-6 MON, exactly the curve's final price**.
  - Gas: about 2.43M for the whole script.
- **Mainnet only:**
  - Flow aggregator: `POST https://ws.kuru.io/api/quote`, with `referrerAddress`/`referrerFeeBps` for integrator revenue, 1 rps per JWT. On testnet it answers "no candidate paths".
  - Data APIs: `exchange.kuru.io` REST/WS and `api.kuru.io`.
- **v2 is testnet only:** AccountCore, builder fees, relay, EIP-7702 trading wallets.
- **SDK:** `@kuru-labs/kuru-sdk` pins **ethers 5.7.1**. Direct viem calls against the ABI JSONs work [K §2.5].
- **Events** have only topic0; every parameter is in `data`, contrary to the docs [K §2.2].
- **Testnet quote-token mismatch:** Kuru's testnet USDC `0x3bA3…1570` (no mint) is not Juno's USDC `0x534b…43A3`.
- **Perps: none.** See §1.
- **Bounties:** "Build the Next Consumer Trading App on Kuru" $5k and "Bring New Assets and Markets to Kuru" $5k. Track 01. No public criteria (https://monad.xyz/developers/hackathons/metropolis). There is a participant copy of the consumer-app criteria (https://github.com/EndPx/kairos/blob/main/docs/HACKATHON_REQUIREMENTS.md, **unverified**).

### 2.2 Strict audit

| Capability | Verdict | Evidence |
|---|---|---|
| Graduating into a Kuru market (`KuruGraduator`) | GENUINELY USED (fork, real Kuru contracts) | `KuruGraduator.sol:97-143`; `test/KuruGraduator.t.sol:125` asserts the ask sits at the curve top and the shares are locked; `:211` covers a market squatted in advance |
| Creator chooses a venue at launch | GENUINELY USED (fork) | `JunoLaunchpad.sol:257,461`; `KuruGraduator.prepare` refuses a non-MON quote or an unquotable price at launch, not at graduation; picker at `post.tsx:362`; API `app/api/juno/tx/launch/route.ts` (`venue`) |
| Quotes and market orders on Kuru | GENUINELY USED (fork) | `lib/juno/kuru.ts:165` (`eth_call` from `address(0)`), `:235` (market buy/sell, approval before a sell); bought and sold from the web app's trade sheet |
| Limit orders on Kuru | GENUINELY USED (fork) | `lib/juno/kuru.ts` `buildKuruLimitOrder` (MarginAccount deposit → `addBuyOrder`/`addSellOrder`), `buildKuruCancel`, `buildKuruWithdraw`; indexer `KuruOrder` follows each order through fills and cancels; `components/KuruOrders.tsx`. The market's tick is one price unit so orders can rest inside the vault's 1% spread; `test_limitOrders_restFillCancelWithdraw` |
| Kuru book/vault data (best bid/ask) | GENUINELY USED (fork) | `kuru.ts:125` → coin page bid/ask/spread and the coin's price after graduation (`lib/juno/chain.ts`) |
| Kuru fills in history and charts | GENUINELY USED (fork) | Envio `KuruMarket`/`KuruTrade` (`indexer/src/EventHandlers.ts:387,416`) → `lib/juno/envio.ts` `envioKuruTrades` → `lib/juno/swaps.ts` |
| Kuru Flow | MISSING, and mainnet-only anyway | none |
| Kuru perps | **Not a Kuru product** | Kuru has no perps (§1) |
| FAKED | none | — |

### 2.3 Where Kuru fits, and where it would be forced
**Organic.** Kuru is what happens **after a curve fills**. `IJunoGraduator` (`prepare` / `graduate`) was designed for exactly this swap. After graduation the coin page, the trade sheet and the reels dock's Buy/Sell switch from the curve to Kuru's book. Two existing features also map naturally:
- The watchlist's `alertPrice` (`lib/juno/social-graph.ts:151`) maps onto a real resting limit order.
- Plans and stop-losses map onto `KuruForwarder`.

**The structural limit.** Most posts never fill, so Kuru is invisible for most of the app's life. The demo therefore has to show launch → fill → graduate into Kuru → trade on the book. The fill-the-curve flow is already verified on the fork.

**Forced:**
- a Kuru panel on pre-graduation posts
- Kuru markets in the Pre-IPO tab
- Flow on testnet
- v2 builder fees (Juno tokens cannot be listed on v2)
- anything called "perps"

### 2.4 Fifty Kuru ideas, ranked by how load-bearing Kuru is
Rows 1–27 cannot be done without Kuru. Rows 28–40 use Kuru but are mainnet-only, secondary, or swappable. Rows 41–50 are weak, blocked, not Kuru at all (Perpl), or should not be built.

| # | What it does | Kuru capability / call | Depth | Why a Kuru judge notices |
|---|---|---|---|---|
| 1 | **Built.** Graduate a filled curve into a Kuru CLOB + AMM-vault market | `KuruGraduator.graduate`: `Router.deployProxy(2, token, 0x0, …)` then `KuruAMMVault.deposit{value:q}(base, q, q, 0xdEaD)`. `prepare()` returns `MarginAccount` as the locked venue | Core | The literal "Bring New Assets and Markets to Kuru": each graduated post is a new market that opens at the curve's top price |
| 2 | **Built.** Creator picks the venue at launch: Uniswap v2 or Kuru | Finish `LaunchParams.graduator` / `graduatorAllowed` (`JunoLaunchpad.sol:101,257`). Add a toggle in the launch sheet | Core | Kuru becomes a first-class choice rather than a hard-coded swap |
| 3 | Show the Kuru market's address on the coin page before graduation | `Router.computeAddress(token, 0x0, …, address(0), false)`, `computeVaultAddress` | Core | Mirrors the pre-locked CREATE2 v2 pair, and shows nobody can pre-seed it |
| 4 | **Built.** Grief-proof graduation | `verifiedMarket(m).pricePrecision == 0` → deploy, else reuse. The vault is still empty, because the token cannot enter `MarginAccount` before graduation | Core | Shows command of Kuru's CREATE2 markets and fund flows [K §3.4] |
| 5 | **Built.** Graduation parameter solver | Port `ParamCreator.calculatePrecisions`: power-of-10 precisions, uint32 price with about 1000x headroom, `kuruAmmSpread % 10 == 0` | Core | Without it, micro-priced post tokens get broken markets |
| 6 | **Built.** Exact quotes for graduated coins | `eth_call` from `address(0)` to `placeAndExecuteMarketBuy/Sell` | Core | A Kuru-specific quoter, vault-inclusive and free |
| 7 | **Built.** Buy and sell graduated posts from the trade sheet and reels dock | `placeAndExecuteMarketBuy{value}(quoteSize, minOut, false, true)`, `placeAndExecuteMarketSell(size, minOut, false, false)` | Core | "Routing through Kuru's onchain order book" is the consumer bounty's reported core requirement |
| 8 | **Built.** Sell with approval handled | Kuru pulls tokens (approve the OrderBook, or deposit to `MarginAccount`). The server builds approve+sell as two steps | Core (necessary) | Honest about the one UX cost the launchpad's approval-free sell did not have |
| 9 | Turn a watchlist price alert into a resting limit order | `MarginAccount.deposit` + `addBuyOrder(price, size, postOnly)`, from `alertPrice` | Core | Only a CLOB can do this. It reuses a feature Juno already has |
| 10 | **Built.** Claim filled limit orders from the portfolio | `MarginAccount.getBalance` shown as "Unclaimed", then `batchWithdrawMaxTokens([token, 0x0])` | Core | Fills credit MarginAccount, not the wallet; handling that shows depth |
| 11 | **Built.** Cancel resting orders | `batchCancelOrders(uint40[])`. Track `OrderCreated`/`OrderCanceled`/`Trade` | Core | The full order lifecycle |
| 12 | Stop-loss / take-profit on graduated posts | EIP-712 `PriceDependentRequest` → Juno relays `KuruForwarder.executePriceDependent`. Funded from the margin balance, because a relayer cannot front native `msg.value` | Core | Kuru's own conditional-order primitive; impossible on Uniswap v2 |
| 13 | Gasless graduated-coin trades | `KuruForwarder.execute(ForwardRequest, sig)`. Allowed: market and limit orders, margin deposit/withdraw. Not allowed: cancels | Core | Gasless through Kuru rather than a paymaster |
| 14 | Depth chart after graduation | Decode `getL2Book()` bytes, synthesize vault levels from `getVaultParams()` (as the SDK's `orderBook.ts` does), replace the curve depth in `app/api/juno/depth` | Core | Book and vault together, as Kuru's own UI shows them |
| 15 | "Back this creator": community LP | `KuruAMMVault.deposit(base, quote, minQuote, receiver)`. LPs earn the spread | Core | Ties the social layer to Kuru market-making |
| 16 | Creator liquidity ladder | Flip orders via `batchProvisionLiquidity(prices, flipPrices, sizes, isBuy, true)` | Core | Flip orders exist only on Kuru |
| 17 | LP position in the portfolio | Vault share balance, `previewWithdraw`, `totalAssets`, `withdraw(shares, receiver, owner)` | Core | Closes the LP loop |
| 18 | **Built.** One chart from first buy to book trading | Decode Kuru `Trade(uint40,address,bool,uint256,uint96,address,address,uint96)` (all fields in data) and append it to the curve history | Core | Graduation stops being a cliff in the data |
| 19 | **Built.** Index Kuru markets in Envio | `contractRegister` on `Graduated` (Kuru venue) → the market's `Trade`. Filter by address, since topics are empty | Core (with Envio) | Kuru trades as first-class indexed data |
| 20 | **Built.** Leaderboard and P&L continue past graduation | Kuru `Trade.taker`/`txOrigin` into `basisFromSwaps` | Core | Kuru volume counts in Juno's core ranking |
| 21 | Spend the graduation refund on Kuru | The buy that completes a curve refunds the rest (verified "Buy only what's left"). Offer "continue on Kuru" with a fresh `address(0)` quote | Core UX | The handoff moment becomes the demo's climax |
| 22 | "Bought by" after graduation | `Trade.taker` into `lib/juno/crowd.ts` | Surface | Social proof from book fills |
| 23 | **Partly built.** Best bid/ask on feed cards and the reels dock for graduated posts | `bestBidAsk()` (1e18-scaled) via Multicall3 | Surface | The book price shows up mid-scroll |
| 24 | Price impact from the book | Walk `getL2Book` plus the vault levels before signing | Surface | Real impact instead of a curve formula |
| 25 | Show the locked vault liquidity | Vault LP shares held at `0xdEaD`, with a vault address link | Surface | A trust signal: liquidity cannot be pulled |
| 26 | Graduation in the live tape | `MarketRegistered` + `Graduated` rows with commit-state dots | Surface (with Monad) | A Kuru market's birth, seen live |
| 27 | **Built.** Foundry proof that the market opens at the curve top | Port the research `sim/` into `contracts/test/` against a testnet fork | Core evidence | "Integration strength" backed by a test |
| 28 | Swap any Monad token into a post-coin (mainnet) | Flow `POST https://ws.kuru.io/api/quote`, send `transaction.{to,calldata,value}` to `0xb3e6778480b2E488385E8205eA05E20060B813cb` | Core on mainnet; **impossible on testnet** | Flow is Kuru's flagship integration |
| 29 | Creators earn Flow referrer fees (mainnet) | `referrerAddress = creator`, `referrerFeeBps` | Mainnet only | A creator-economy twist on Flow |
| 30 | Multi-hop sell: token → MON → USDC | `Router.anyToAnySwap(markets, isBuy, nativeSend, debit, credit, amount, minOut)` | Weak on testnet: MON/USDC there is dead and uses Kuru's own USDC | Uses the Router, but the demo would be thin |
| 31 | Plans on graduated coins | Presigned `ForwardRequest`s with deadlines, relayed on schedule [unverified: forwarder nonce ordering] | Mid | Forwarder instead of custody |
| 32 | USDC curves graduate to a Kuru USDC market | Type-0 market with Juno's USDC `0x534b…` | Mid | Works, but connects only to Juno's own markets |
| 33 | Kuru "instant market" launch mode | `MonadDeployer.deployTokenAndMarket` (testnet only) | Mid; undercuts Juno's own curve | Uses a Kuru product, but competes with Juno's thesis |
| 34 | Live Kuru trades and book (mainnet) | `wss://exchange.kuru.io/ws` `@trade`, `@depth5` (binary frames) | Surface, mainnet only | — |
| 35 | Book at each commit state (mainnet) | `/api/v3/depth?state=proposed` (also `voted`, `finalized`), next to Juno's finality dots | Surface, mainnet only | Kuru and Monad commit states in one view |
| 36 | A rail of mainnet Kuru markets in the Trade tab | `api.kuru.io/api/v1/markets` (5m/1h/24h stats) | Swappable | Not Juno content |
| 37 | Cross-check MON/USD | Kuru MON/USDC `bestBidAsk` (mainnet) against Pyth | Swappable | Decorative |
| 38 | Order history on the profile (mainnet) | `api.kuru.io/api/v3/{user}/user/order-events` | Swappable; on testnet use events or Envio | — |
| 39 | Explain a failed trade | `mm-tx-simulator.aws.kuru.io/tx/<hash>` (1 rps) [docs] | Weak | — |
| 40 | Book analytics | Daily L2 Parquet snapshots [docs] | Weak | — |
| 41 | Kuru v2 builder fees | `AccountCore.approveBuilder`/`claimBuilderFees`. v2 listing is permissioned, so Juno tokens cannot list | Weak / blocked | — |
| 42 | v2 EIP-7702 trading wallet | `KuruTradingWallet` intents. A delegated EOA can never dip below 10 MON on Monad, so MON-quoted buys from small wallets revert | Weak / risky | — |
| 43 | Market-making bot for graduated markets | `kuru-sdk-py` | Weak: off-app, invisible to a consumer judge | — |
| 44 | Kuru "Discover"/verified listing for graduated posts | Needs Kuru's team; no code | Weak (outreach) | — |
| 45 | Mainnet graduation into Kuru | The owner Safe must call `deployProxy` or allowlist the graduator | Not code; the only path to mainnet | Ask the CEO-mentor [K §5] |
| 46 | **Partly built.** **Perpl, not Kuru:** "hedge your MON" from the trade sheet | Perpl testnet `0x1964C32f0bE608E7D29302AFF5E61268E72080cc`: `createAccount` (≥100 aUSD; the testnet aUSD source is undocumented) + `execOrders(OrderDesc[])` | A separate Track 01 sponsor; composes with Kuru only through MON's price | — |
| 47 | **Partly built.** **Perpl, not Kuru:** MON basis panel, Kuru spot vs Perpl perp | Kuru `bestBidAsk` + Perpl `GET /v1/pub/context` (mark, funding) | Fits Perpl's analytics bounty more than Kuru's | — |
| 48 | **Partly built.** **Perpl, not Kuru:** perps on majors with a builder code | Perpl API, an Ed25519 key, a builder id via their form, a whitelisted origin. `geo_block` includes US and GB | A separate sponsor; post-tokens cannot get perps | — |
| 49 | AUSD-quoted markets for Agora | Kuru MON_AUSD exists on mainnet. Agora needs Mera + AUSD + a Perpl trade | Weak for Juno; conflicts with Privy | — |
| 50 | A "Kuru perps" button | None exists. Kuru's SDK: "Perps are intentionally not exposed in v1" | **Do not build** | It would tell a Kuru judge the team did not read Kuru's docs |

---

## 3. Envio

### 3.1 What Envio offers
Index: https://docs.envio.dev/llms.txt. Capability detail is in [ME §3.2].

- **HyperIndex v3:**
  - **Dynamic contracts:** `contractRegister` + `context.chain.X.add`, with same-block backfill (https://docs.envio.dev/docs/HyperIndex/dynamic-contracts).
  - **Effect API:** `createEffect` with `cache`, `rateLimit` and `crossChain: false` (https://docs.envio.dev/docs/HyperIndex/effect-api).
  - **Preload-aware handlers, and `getWhere`.**
  - **Block handlers:** `onBlock`, with only `block.number` available (https://docs.envio.dev/docs/HyperIndex/block-handlers).
  - **GraphQL subscriptions:** "at your own risk", with 10 or fewer connections on non-dedicated plans (https://docs.envio.dev/docs/HyperIndex/websockets).
  - **Reorg rollback** (https://docs.envio.dev/docs/HyperIndex/reorgs-support).
  - **`_meta` sync status.**
  - **A testing framework.**
- **HyperSync:**
  - Monad testnet at `https://monad-testnet.hypersync.xyz` (https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks). A token is required.
  - Measured head lag on Monad testnet: 2–3 blocks, about 0.6–0.9 s [ME §3.2].
- **HyperRPC:** read-only JSON-RPC with no 100-block `getLogs` cap, at `https://monad-testnet.rpc.hypersync.xyz/<token>` (https://docs.envio.dev/docs/HyperRPC/overview-hyperrpc).
- **Envio Cloud:**
  - The free dev plan has soft limits of 100k events, 5 GB, or 7 idle days, and is **deleted after 30 days** (https://docs.envio.dev/docs/HyperIndex/hosted-service-billing).
  - A deploy made today dies mid-judging, so **redeploy between 1 and 10 Oct** [ME §3.3].
- **The bounty** (participant-quoted from the dashboard, https://github.com/precious-akpan/monad-metropolis-merchant-rails):
  - Text: "Meaningfully use Envio's HyperIndex, HyperSync, or HyperRPC to power real on-chain data driving a core feature in your app."
  - Prize: $1,000 plus free Envio Cloud hosting. All tracks.
- **The bar set by a competitor:** adexto-monad publishes a public GraphQL endpoint, "verified against contract storage", and a measured HyperSync backfill (https://github.com/0xcuy/adexto-monad).

### 3.2 Strict audit

| Capability | Verdict | Evidence |
|---|---|---|
| HyperIndex project: 9 launchpad events + per-token `Transfer` | GENUINELY USED (fork) | `indexer/config.yaml:25-53`; `EventHandlers.ts:119-120` (`contractRegister` → `JunoToken.add`), `:438` (Transfer handler) |
| RPC as the sync source, so no HyperSync token | GENUINELY USED (fork) | `config.yaml:67-69` |
| Effect API (decimals: `cache`, `rateLimit`) | GENUINELY USED, rarely hit | `indexer/src/quotes.ts:39-45`. MON/USDC decimals are hard-coded, so the effect seldom fires [ME §3.4] |
| Trade history from `Trade` | GENUINELY USED | `envio.ts:69` → `swaps.ts:312-313` |
| Complete holders, including transfer recipients | GENUINELY USED | `envio.ts:106` → `activity.ts:93-102`; the UI says so at `app/coin/[token].tsx:770` |
| Holder count from `Pool` | GENUINELY USED | `envio.ts:158` → `chain.ts:278-281` |
| Whole portfolio from `Position` | GENUINELY USED | `envio.ts:130` → `portfolio.ts:308-309,376` |
| Indexer freshness (`_meta`) | GENUINELY USED (fork) | `envioStatus` → `app/api/juno/coins/[token]/route.ts` (`indexer`) → the holders tab's "current to block N" |
| Leaderboard from the index | GENUINELY USED (fork) | `leaderboard.ts` `indexedHistories`: every curve and Kuru fill in paginated queries |
| Kuru markets, fills and orders | GENUINELY USED (fork) | `config.yaml` `KuruGraduator` → dynamic `KuruMarket`; entities `KuruMarket`, `KuruTrade`, `KuruOrder`; Kuru fills update `Position` |
| Post-graduation pair (`Swap`/`Sync`) | MISSING | No pair contract in `config.yaml` |
| Candles / time-series entities | MISSING | No such types in `schema.graphql`. Candles are built in the app |
| GraphQL subscriptions | MISSING | — |
| HyperSync client or HyperRPC outside the indexer | MISSING | The log tail is still RPC with 100 blocks by default (`swaps.ts:191,221`) |
| Envio Cloud, real testnet, a public endpoint | MISSING | Launchpad address defaults to `0x0` (`config.yaml:74`) |
| New `GraduatorAllowed` event | MISSING | Not in `config.yaml:37-46` |
| FAKED | none | — |

### 3.3 Where Envio fits, and where it would be forced
**Organic.** Envio is Juno's memory: everything about a coin, a trader or a creator that spans more than 30 seconds of chain. That covers:
- the coin page (history, holders, stats, creator earnings)
- the portfolio
- the leaderboard
- the trader page (`juno-expo/app/trader/[wallet].tsx`)
- feed ranking (trending, graduating soon)
- charts
- notifications

The Monad WebSocket covers the last second, and Envio covers everything before it.

**Forced:**
- indexing the off-chain social layer (likes, comments, follows)
- phones holding their own GraphQL subscriptions
- replacing Postgres wholesale
- using HyperSync for mainnet wallet profiling, which Nansen does better

### 3.4 Fifty Envio ideas, ranked
Rows 1–24 put Envio on the critical path of a user-visible feature. Rows 25–39 are supporting or technical. Rows 40–50 are weak, polish, or forced.

| # | What it does | Envio capability | Depth | Why an Envio judge notices |
|---|---|---|---|---|
| 1 | Index the real testnet launchpad via HyperSync, host it on Envio Cloud, publish the GraphQL URL in README/JUNO.md | `ENVIO_API_TOKEN`, HyperSync primary (`config.yaml:67-69`), Cloud GitHub deploy | Core prerequisite | "Real on-chain data" that a judge can query |
| 2 | **Built.** Leaderboard straight from positions | `Position(order_by:{realizedPnl: desc})` / `Account` aggregate, replacing the per-pool walk in `leaderboard.ts` | Core | A core screen driven by one indexed query; ends "partial" rankings |
| 3 | **Partly built (Kuru only).** Price and P&L continue after graduation | `contractRegister` on `Launched` adds `venue` as `JunoPair` (`Swap`, `Sync`, `Mint`, `Burn`) | Core | Dynamic contracts used twice; closes the freeze at graduation [ME §3.4] |
| 4 | **Built.** Kuru market indexing (if Kuru ships) | Register the OrderBook from `Graduated`, decode topic0-only `Trade` data | Core | Indexes a third-party protocol's markets created by Juno |
| 5 | Candles as entities (1s/1m/5m/1h) | `Candle` keyed `${token}-${interval}-${bucket}`, upserted in the `Trade`/`Swap` handlers from `event.block.timestamp` | Core | Replaces app-side candle building (`juno-expo/lib/candles.ts`) and matches adexto's "sub-second candles" |
| 6 | **Partly built (holders tab).** Freshness chip: indexer block vs chain head | Wire `envioStatus()` (`envio.ts:188`) into `GET config`, show it on the coin page | Surface, judge-visible | Proves live indexing on screen |
| 7 | Trending and "marketCap" sorts from indexed volume | `Pool(order_by: …)` plus a `PoolHourData` entity | Core | The feed's order becomes an Envio output |
| 8 | Creator earnings page | `CreatorClaim` + `Pool.creatorFeesEarned/Claimed` (never read today) | Core | The Track 03 creator story, on indexed data |
| 9 | Trader page from one query | `Account` + `Position` + `Trade` for `app/trader/[wallet].tsx` | Core | Replaces multi-RPC assembly |
| 10 | "Early believer" badge | The handler stamps each `Position` with pool progress at its first buy | Core | Only an indexer that saw every trade can say it |
| 11 | Fastest-to-graduate board | `Graduation` with launch→fill time and distinct buyers | Core | Uses an entity nobody reads yet |
| 12 | Holder concentration (top-10 share) | Maintained in the `Transfer` handler | Core | Builds on the complete holder set that already exists |
| 13 | Server-side subscription feeding the live tape | One Hasura live query on `Trade(order_by: blockNumber desc, limit: 20)` merged with the Monad WS head | Core | Envio for history, Monad for the last second, respecting the ≤10-connection caveat |
| 14 | Post captions and media in GraphQL | `createEffect ipfsMetadata(uri)` with `cache: true` | Core | The indexer becomes the post index, not just a trade log |
| 15 | USD value at trade time | Effect `pythPrice(feedId, minuteBucket)` → `Trade.usdValue` | Core | USD P&L that does not drift with today's MON price |
| 16 | "Someone bought your post" push | Effect gated on `context.chain.isRealtime && !context.isPreload`, sent after finality | Core | Notifications from the indexer; effects are not rolled back, so wait for finality |
| 17 | Watchlist alerts from the indexer | Price-crossing check in the `Trade` handler (alerts synced via an effect) | Core | Alerts that fire for trades made anywhere |
| 18 | Plan progress verified from indexed trades | `Trade(where: {trader, token, blockTimestamp_gte})` instead of trusting `PATCH plans` | Core | On-chain truth for a social feature |
| 19 | "Graduating soon" rail | `Pool(order_by: progress desc, where: {complete: false})` | Core | A new feed surface |
| 20 | Replace the 100-block log tail | `@envio-dev/hypersync-client` `get` on launchpad `Trade`, replacing `syncTrades` (`swaps.ts:221`) | Core | Uses HyperSync directly, not only through HyperIndex |
| 21 | Crowd stats from positions | `lib/juno/crowd.ts` diamond hands/holders from `Position` rather than a walked window | Core | — |
| 22 | Portfolio value over time | A `PositionSnapshot` per trade | Core | — |
| 23 | Creator totals | `Account.launched`, total raised, total fees | Core | — |
| 24 | Wash-trade flagging | Handler marks round-trips and self-transfers; the leaderboard excludes them | Core | The rules disqualify wash trading |
| 25 | Cross-check indexer against contract | Script comparing `Pool` to launchpad storage per pool | Technical credibility | The same claim adexto makes |
| 26 | Backfill benchmark in the README | HyperSync vs RPC blocks per second | Surface | — |
| 27 | Index `GraduatorAllowed` and each pool's venue | Add the event to `config.yaml` | Small fix | Otherwise the indexer misses venue choice |
| 28 | Graduation stats per venue (Kuru vs v2) | Needs #27 | Mid | — |
| 29 | Protocol stats page | `ProtocolDayData` | Surface | — |
| 30 | Time-decayed trending score | `onBlock` with `_every: 200` (about 1 min) | Mid | Uses block handlers; they only get `number` |
| 31 | Tune reorg depth for Monad | `max_reorg_depth` of about 10 [unverified recommendation] | Technical | — |
| 32 | Turn mainnet on when deployed | `ENVIO_JUNO_SKIP_MAINNET=false` (`config.yaml:79-84`) | Surface | Multichain config already written |
| 33 | "This trader also holds" | HyperSync ERC-20 `Transfer` query by address | Mid | — |
| 34 | Mark history for stock trackers | Effect records the Pyth/Tessera mark per trade | Mid | — |
| 35 | "People you follow bought" | Postgres follows × Envio trades, joined in the API | Mid | — |
| 36 | Juno-side inputs for the Nansen composite | Positions and early-buy stamps | Cross-sponsor | — |
| 37 | "Verify this number" links | Every stat links to its GraphQL query | Surface | — |
| 38 | **Built.** Handler tests for the new contracts | Vitest simulated events (`indexer/test/indexer.test.ts`) | Technical | — |
| 39 | Faucet abuse hints | Wallets funded but never traded | Weak | — |
| 40 | `bytes_type: uint8array`, per-handler `fields`, `@internal` | v3.7/v3.10 features | Weak (polish) | — |
| 41 | ClickHouse storage for `Trade` | Experimental | Weak | — |
| 42 | Prometheus status page | `/metrics` | Weak | — |
| 43 | Per-branch Cloud deploys | Envio Cloud | Weak | — |
| 44 | Wildcard ERC-20 transfers into Juno wallets | `wildcard: true`; would burn the 100k-event free tier | Weak | — |
| 45 | Dev Console screenshots in the demo | — | Weak | — |
| 46 | Phones subscribe directly | Not recommended beyond 10 connections | Forced | — |
| 47 | Index likes and comments | Off-chain data; not Envio's job | Forced | — |
| 48 | Replace Postgres with Envio | The social layer is off-chain | Forced | — |
| 49 | Profile mainnet wallets with HyperSync | Nansen does this better | Swappable | — |
| 50 | Index other chains | No product reason | Weak | — |

---

## 4. Privy

### 4.1 What Privy offers
Feature matrix: https://docs.privy.io/basics/react-native/features [PN §1.2].

- **Packages:**
  - `@privy-io/expo` 0.74.3: iOS/Android only, **web not supported**. It needs an Expo **development build**, and its viem peer dependency is exactly 2.56.0, which is what `juno-expo/package.json:31` pins.
  - `@privy-io/react-auth` 3.45.0: web.
  - `@privy-io/node` 0.35.0: server. It has `verifyAccessToken`, `createViemAccount` and `createX402Client`.
- **Login:** email/SMS OTP, OAuth (Google, Apple, Twitter …), passkeys, SIWE link/login, Farcaster, guest accounts.
- **Embedded EVM wallet:**
  - Signing: `eth_signTransaction`, `personal_sign`, `eth_signTypedData_v4`, and EIP-7702 authorization. Custom chains are supported, including Monad testnet 10143.
  - `eth_signTransaction` signs the caller's nonce, gas and fees as given, so it fits `Signer` [PN §1.2].
- **Native gas sponsorship.** It lists **Monad Testnet** (https://docs.privy.io/wallets/gas-and-asset-management/gas/overview).
  - Mechanism: EIP-7702 plus a paymaster. The address is unchanged.
  - It needs **TEE execution**, and dashboard sponsorship enabled with credits.
  - In Expo it works **only through a server relay**: `sendTransaction({caip2:'eip155:10143', sponsor:true, authorization_context:{user_jwts:[jwt]}})`.
- **Signers + policies + stateful aggregations** (https://docs.privy.io/wallets/using-wallets/signers/overview, https://docs.privy.io/controls/policies/overview, https://docs.privy.io/controls/policies/stateful-policies):
  - The app holds a P-256 key quorum.
  - The user consents with `useSigners().addSigners`.
  - Policies are default-deny and match on `chain_id`, `to`, `value`, decoded calldata and time.
- **Other features:**
  - MFA
  - webhooks
  - user API
  - onramp (`useFundWallet`, MoonPay/Coinbase; no testnets)
  - crypto deposits (mainnet)
  - key export (React only)
  - global wallets
  - x402 client (React, Node)
- **Monad templates:** `react-native-privy-embedded-wallet-template` and `react-native-privy-pimlico-gas-sponsorship-template` [PN §1.3].
- **The bounty** (a verbatim participant capture [PN §1.4]):
  - "Your project must integrate Privy beyond authentication. Using Privy only for login/authentication will not qualify."
  - "Demo must clearly show the functionality powered by Privy. Bonus points for meaningfully integrating multiple Privy features."
  - $5,000, single prize, all tracks.

### 4.2 Strict audit

| Capability | Verdict | Evidence |
|---|---|---|
| Any Privy SDK call | GENUINELY USED (web), login not yet run by us | `juno-expo/lib/privy.web.tsx` (`PrivyProvider`, `useLogin`, `useCreateWallet`, `useSignTransaction`, `useSignMessage`); `lib/juno/privy.ts` (`PrivyClient`, `verifyAccessToken`, `users()._get`) |
| Verified identity (X handle) on profiles | GENUINELY USED, login not yet run by us | `app/api/juno/profiles/privy/route.ts`; `GET profiles` returns `identities`; `components/SignerChoice.tsx` |
| Native embedded wallet | MISSING, and the wrong package is installed | `react-auth` is web-only; native needs `@privy-io/expo` + a dev build |
| Signer seam ready for it | Present (not a Privy use) | `wallet.tsx:48` (`WalletMode` includes `"privy"`), `:51` `Signer`, `:61` `SignerSource`, `:185` the only source, `localKeySource`, `:236-239` the `source` prop |
| Delegated or recurring execution | MISSING | `app/api/juno/plans/route.ts:38-39`: "needs a delegate or a session key … which this project does not have" |
| Dashboard app matching Juno | MISSING | The app "norr" has no native identifiers (`fun.juno.app`) or URL scheme (`juno`). Its allowed web origins are localhost and `norr.fun`, not Juno's web build |
| FAKED | none | — |

### 4.3 Where Privy fits, and where it would be forced
**Organic:**
- **Every signature.** The `Signer` seam means Privy signs launches, buys, sells, claims and name claims, and no screen changes.
- **The launch flow.** A sponsored zero-MON first post.
- **Plans and watchlist alerts.** Signers with policies make them execute for real.
- **The faucet.** A server wallet with a policy instead of a raw key.
- **The profile.** A verified X handle for creators.
- **Linked wallet.** SIWE-linking a mainnet wallet, which is the only honest input to Nansen.

**Forced:**
- onramp on testnet
- ERC-4337 smart wallets (they change the address that Juno's server-built, `from`-checked flow relies on)
- EIP-7702 upgrades for MON-quoted buys (Monad's reserve rule)
- global wallets (no confirmed Monad ecosystem provider)
- "Privy + Mera" (the Mera bounties exclude Privy)

### 4.4 Fifty Privy ideas, ranked
Rows 1–15 are Privy doing the work: sign, sponsor, or delegate. Rows 16–30 are useful secondary features. Rows 31–50 are weak, testnet-blocked, or do-not-build.

| # | What it does | Privy capability / call | Depth | Why a Privy judge notices |
|---|---|---|---|---|
| 1 | **Built (web).** Privy signs every launch, trade and claim | `PrivySignerSource`: `useEmbeddedEthereumWallet` → `getProvider().request({method:'eth_signTransaction', params:[{…request, type: 2}]})` → existing `/tx/submit` | Core | Plainly "beyond login": every on-chain action in the demo is Privy-signed |
| 2 | A brand-new user launches a post with 0 MON | Server `@privy-io/node` `sendTransaction(walletId, {caip2:'eip155:10143', sponsor:true, …, authorization_context:{user_jwts:[jwt]}})` after `verifyAccessToken`; `firstBuy = 0` | Core | Native sponsorship on Monad Testnet, shown on camera |
| 3 | Plans that actually execute | `useSigners().addSigners({address, signers:[{signerId, policyIds}]})`. Policy: `chain_id == 10143`, `to == JunoLaunchpad`, calldata `buy.recipient == user`, `value <= cap`, expiry | Core | Fixes the stated gap in `plans/route.ts:38-39`. Signers are Privy's headline "offline actions" |
| 4 | A rolling 24h spend cap on that signer | Stateful policy (aggregation) on `eth_signTransaction` | Core | A second policy feature layered on the first ("bonus for multiple features") |
| 5 | Show and revoke the grant in-app | Render the policy in plain words; `removeSigners` | Core | "Demo must clearly show" what Privy powers |
| 6 | Watchlist alerts that trade | The signer signs a buy/sell when the tape crosses `alertPrice`. Policy limits it to `buy`/`sell` with recipient = self | Core | Offline execution with a tight policy |
| 7 | Auto-claim creator fees weekly | Signer policy: `to == launchpad`, function `claimCreatorFees(token, to)` (`JunoLaunchpad.sol:418`) with `to == creator` | Core | The narrowest, most legible policy in the app |
| 8 | Gas-free creator fee claim | `sponsor: true` on `tx/claim` | Core | Sponsorship beyond onboarding |
| 9 | **Built.** Verified X handle on a creator's posts | `useLoginWithOAuth` (twitter) → `linked_accounts` on the profile and post header | Core (Track 03) | Identity that powers the social layer |
| 10 | Link a mainnet wallet | `useLinkWithSiwe` (the app produces the signature; the domain is allowlisted) | Core (feeds Nansen) | A second auth primitive used for a product feature |
| 11 | Faucet key in a Privy server wallet | Server wallet + policy: value transfers only, `value <= 1 MON`, empty calldata; replaces the raw key used by `faucet/route.ts` | Core (ops) | The policy engine on the server side |
| 12 | **Built.** Web build on Privy | `@privy-io/react-auth` (already in `juno-expo/package.json:7`) in `*.web.tsx`; hook-level `sponsor: true` works on web [unverified in Metro web] | Core for web judges | Uses the installed dependency for its real purpose |
| 13 | Gift a post-coin to an email before they join | Server creates a user with a pregenerated embedded wallet by email [unverified API name], sends tokens, and they are there at login | Core (social) | Privy's user API used for onboarding |
| 14 | Pay Nansen per call from a server wallet | `createX402Client` (`@privy-io/node/x402`) on `eip155:143` USDC | Core (cross-sponsor; real money) | Privy's x402 client in production use |
| 15 | Sponsored "Graduate it" button | Anyone may call `graduate`; the app sponsors it | Mid | — |
| 16 | Passkey login | `@privy-io/expo/passkey` with AASA on a Juno domain | Mid | Monad's Track 04 signal, but it excludes Mera |
| 17 | MFA before large sells | `useMfa` + policy-based MFA threshold | Mid | — |
| 18 | Privy tokens on social writes | `verifyAccessToken` on comments/likes/follow alongside the wallet | Mid | Sybil resistance for the social layer |
| 19 | Provision the profile on sign-up | `user.created` webhook (svix) | Mid | — |
| 20 | Survive a second device | Privy recovery (the device key cannot) | Mid | — |
| 21 | Move from device key to Privy in one tap | Server builds transfers for every holding to the Privy address | Mid | — |
| 22 | Export key | react-auth export on a hosted web page (Expo has none) | Mid | — |
| 23 | Guest accounts that upgrade | Guest login | Mid | — |
| 24 | Farcaster login + cross-post launches | Farcaster auth | Mid | — |
| 25 | Sponsorship abuse limits | Sponsor only verified email/X users; per-user caps | Mid | — |
| 26 | Protocol-fee treasury wallet | Server wallet; policy allows only `claimProtocolFees` to the treasury | Mid | — |
| 27 | Separate creator and trading wallets | Multiple embedded wallets (HD index) | Mid | — |
| 28 | Tip a creator by X handle | Look up a Privy user by Twitter username [unverified endpoint] → wallet | Mid | — |
| 29 | Relay with the user's authorization signature | `useAuthorizationSignature().generateAuthorizationSignature` | Technical | — |
| 30 | "Your post was bought" via transaction webhooks | Free in development; **production needs Enterprise** | Mid / weak | — |
| 31 | Card onramp | `useFundWallet` (MoonPay/Coinbase sandbox). Testnet MON cannot be bought [unverified] | Weak on testnet | — |
| 32 | Deposit from other chains | `useHeadlessCryptoDeposit`, mainnet by nature | Weak on testnet | — |
| 33 | Cross-app global wallet | `useLoginWithCrossApp`; no Monad ecosystem provider confirmed | Weak | — |
| 34 | Smart-wallet batching (approve + buy) | Kernel / `SmartWalletsProvider`. It changes the address, and USDC `permit` is simpler | Weak | — |
| 35 | EIP-7702 upgrade | `useSign7702Authorization`. A delegated EOA cannot dip below 10 MON, so MON buys revert | Risky | — |
| 36 | Gas spend view | `GET /v1/apps/gas_spend` | Weak (ops) | — |
| 37 | SMS login | — | Weak (baseline) | — |
| 38 | Handle in custom metadata | `custom_metadata` | Weak | — |
| 39 | Beta allowlist | Allowlist/denylist | Weak | — |
| 40 | Privy UI login sheet | `@privy-io/expo/ui` | Surface | — |
| 41 | wagmi connector | `@privy-io/wagmi` | Weak | — |
| 42 | Pimlico template instead of native sponsorship | It exposes the Pimlico key in `EXPO_PUBLIC_*` and changes the address | Weak | — |
| 43 | Solana embedded wallet | — | Irrelevant | — |
| 44 | Stripe onramp | "does not support testnets" | Weak | — |
| 45 | "No popups" session signing | Juno already signs without prompts | Weak | — |
| 46 | Import X follows | Privy does not expose a social graph | Forced | — |
| 47 | Sponsored likes | Likes are off-chain | Forced | — |
| 48 | Legacy delegated actions | `useHeadlessDelegatedActions` is pre-TEE, and migrating resets it; use signers | Do not build | — |
| 49 | Privy together with Mera | The Mera bounties exclude Privy; pick one | Do not build | — |
| 50 | Login-only Privy | Disqualified by the bounty text | Do not build | — |

---

## 5. Nansen

### 5.1 What Nansen offers
Details in [PN Part 2].

- **The API:** `https://api.nansen.ai/api/v1/...`, mostly POST, with an `apikey` header.
  - Families: Smart Money, Token God Mode, Profiler (`pnl-summary`, `current-balance`, `transactions`, `related-wallets`, `counterparties`, `first-funder`, `labels`), search, screener, agent, smart-alerts.
  - Chain matrix: https://docs.nansen.ai/reference/chains. Monad **mainnet** is covered on almost every family, with data from 14 May 2025.
  - **No testnet** appears anywhere in the OpenAPI spec.
- **Credits** (https://docs.nansen.ai/getting-started/credits):
  - Free plan: 100 one-time credits, then 10 per day.
  - Most profiler and TGM calls cost 1 credit. Labels cost **100**, premium labels **500**.
- **x402 pay-per-call** in USDC on Monad mainnet (`eip155:143`), confirmed by a live 402 challenge. It costs $0.01 basic and $0.05 for smart money, and **labels are excluded** (https://docs.nansen.ai/getting-started/agentic-payments).
- **Other access:** a CLI (`nansen-cli`), an MCP server (`https://mcp.nansen.ai/ra/mcp`), and public Points endpoints that need no auth (https://docs.nansen.ai/api/points).
- **Redistribution rules** (https://docs.nansen.ai/guides/redistribution-guide):
  - **Free to display:** balances, PnL, PnL-summary.
  - **Display with attribution:** transactions, counterparties, related-wallets, TGM flows, who-bought-sold.
  - **Restricted** (approval plus "significant modification"): smart-money inflows, and holders filtered to smart money.
  - **Prohibited in any public UI:** `address/labels`, `smart-money/holdings`, `smart-money/dex-trades`, `tgm/pnl-leaderboard`.
- **The bounty:** "Build a product experience powered by Nansen data/API/MCP/CLI that goes beyond exposing raw data."
  - $5,000 pool, all tracks. No fuller judging card was found.
  - **Nansen's CEO is a main-track judge** [PN §2.4].

### 5.2 Strict audit

| Capability | Verdict | Evidence |
|---|---|---|
| Any Nansen call, key or dependency | MISSING | none |
| "Smart money is buying this reel" (`docs/METROPOLIS.md:42`) | Not built, **impossible and prohibited** | Juno's tokens are testnet (no data), and public smart-money display is banned |
| Linked mainnet wallet (the only honest input) | MISSING | Needs Privy SIWE link or a signed-message link. Neither exists |
| FAKED | none | — |

### 5.3 Where Nansen fits, and where it would be forced
**The only honest attachment point** is a **user's other, mainnet wallet**, linked by signature. Nansen can say who a person is elsewhere. It cannot say anything about their trading on Juno. That feeds:
- trader and creator credibility
- social proof on the feed ("proven traders are buying"), built from Juno's own buyers
- leaderboard sybil resistance
- faucet anti-abuse
- comment ranking

Every one of these needs a composite that mixes Nansen with Juno's own data (via Envio), and never shows labels. That is also what "beyond raw data" asks for.

**Forced:**
- anything about Juno tokens or testnet wallets
- MON market strips (decorative)
- smart-money feeds (prohibited or restricted)
- an AI blurb (200+ credits to restate PnL)

**The costs, stated plainly.** It works only for users who opt in to linking. The free credits cover a demo only if labels are avoided. x402 means spending real mainnet USDC.

### 5.4 Fifty Nansen ideas, ranked
Rows 1–15 are load-bearing: remove Nansen and the feature is gone. Rows 16–22 are supporting. Rows 23–40 are weak or forced. Rows 41–50 are **do not build**: prohibited or impossible. They are listed so nobody builds them.

| # | What it does | Nansen capability / endpoint | Depth | Why a Nansen judge notices |
|---|---|---|---|---|
| 1 | "Proven trader" composite score for a linked mainnet wallet | `profiler/address/pnl-summary` (monad + ethereum/base), `current-balance`, Points tier (`GET app.nansen.ai/api/points-leaderboard/{address}`), plus Juno's own Envio data. No labels | Core | A derived indicator, the guide's allowed "Custom Composite Indicators" example; clearly beyond raw data |
| 2 | "Proven traders are buying this reel" on feed cards and coin pages | Juno's testnet buyers weighted by their score from #1 | Core | The honest, compliant replacement for `METROPOLIS.md:42` |
| 3 | Creator credibility at launch | The creator's linked-wallet `pnl-summary` + age → an "established wallet" signal on the launch card | Core | An anti-rug signal for a launch product |
| 4 | Sybil-resistant leaderboard | Rank weighted by score. `related-wallets`/`first-funder` clustering used internally only | Core | Uses Nansen to protect a core ranking; the rules ban wash trading |
| 5 | Pay per lookup in USDC on Monad mainnet | x402 `eip155:143`, $0.01/call, via a Privy server wallet's `createX402Client` | Core (cross-sponsor; **real money**) | Every lookup is a Monad mainnet settlement, with no key or subscription |
| 6 | Faucet tiers | The faucet grants more to wallets whose linked mainnet wallet passes a threshold (internal) | Core | Nansen data protecting a Monad testnet resource |
| 7 | "Who is this trader" card on the trader page | `pnl-summary` (free to display), Points tier, Juno stats, "Powered by Nansen API" | Core | A product surface, not a data dump |
| 8 | Comments ranked by reputation | Comments from proven wallets surface first | Core (Track 03) | Nansen shaping a social feed |
| 9 | Creator audience quality | Share of a creator's buyers with proven linked wallets | Core | A new metric only this combination can produce |
| 10 | Self-dealing warning | The creator's `related-wallets` intersected with buyers' linked wallets (internal flag, shown as a neutral caution) | Core (integrity) | Uses related-wallets for trust |
| 11 | "Your trading, everywhere" | The user's **own** wallet `pnl-summary` next to Juno P&L in the portfolio | Mid | Privacy-safe, and PnL is freely displayable |
| 12 | Points tier badge | Public Points endpoint (no auth, no credits) | Surface | Free, compliant, visible |
| 13 | "OG Monad" badge | Earliest Monad mainnet activity from `profiler/transactions` or `historical-balances` | Mid | — |
| 14 | Personalized first feed | `current-balance` categories seed "For you" | Mid | — |
| 15 | Score explainer with attribution | Shows inputs and weights, never labels | Required surface | Shows the "beyond raw data" transformation |
| 16 | File the redistribution approval | https://forms.gle/AoXk9jRdbuiqqG5f9, if any smart-money-derived input feeds the score | Process | Compliance a Nansen judge will check |
| 17 | Cache and cost control | One profile per wallet per day, about $0.03–0.09 or 3–9 credits | Technical | — |
| 18 | Fee rebate / airdrop eligibility by score | Server-side eligibility list | Mid | — |
| 19 | "Proven creators" discovery rail | Score-ranked creators | Mid | — |
| 20 | After a mainnet graduation, real token data | `tgm/who-bought-sold`, `tgm/holders` (without the smart-money filter) for Juno tokens trading on mainnet | Future only | — |
| 21 | "Real Monad user" check | `current-balance` on `monad` | Surface | — |
| 22 | Faucet cluster detection | `first-funder` (treat as internal only [unverified]) | Internal | — |
| 23 | MON context strip | `tgm/token-information`, `flow-intelligence` (attribution) | Weak / decorative | — |
| 24 | Monad mainnet screener rail | `token-screener` | Weak | Unrelated to Juno's posts |
| 25 | Top tokens on Monad | `nansen-score/top-tokens` | Weak | — |
| 26 | "Monad is #N" | `chains/chain-rank` | Weak | — |
| 27 | AI "who is this trader" blurb | `agent/fast` (200 credits) | Weak / expensive | — |
| 28 | Nansen MCP in the team's workflow | `mcp.nansen.ai` | Weak: not product | — |
| 29 | CLI demo scripts | `nansen-cli` | Weak | — |
| 30 | Smart alerts to the team's Slack | `smart-alerts` | Weak | — |
| 31 | Polymarket odds next to cultural posts | Prediction-market endpoints | Forced | — |
| 32 | Nansen trading API | Not on testnet; competes with Kuru | Weak | — |
| 33 | Counterparties on the trader card | Attribution required; privacy-sensitive | Weak | — |
| 34 | "Net loser on mainnet" warning | Shaming users | Forced | — |
| 35 | Reputation-gated on-chain fee discount | The contract cannot read Nansen; it would need a server attestation | Forced | — |
| 36 | Follow suggestions from related-wallets | Privacy-invasive | Forced | — |
| 37 | Entity names for linked wallets via free search | Label-like; check the rules first | Weak / caution | — |
| 38 | Hyperliquid perp positions | Irrelevant to Monad | Weak | — |
| 39 | Backtesting | Irrelevant | Weak | — |
| 40 | DeFi holdings panel | Decorative | Weak | — |
| 41 | Historical smart-money holdings | Prohibited to display | **Do not build** | — |
| 42 | "Hot on Monad" smart-money netflow | Restricted without approval | **Do not build** | — |
| 43 | Copy smart-money trades | `smart-money/dex-trades`: prohibited | **Do not build** | — |
| 44 | Embed the TGM PnL leaderboard | Prohibited | **Do not build** | — |
| 45 | Nansen labels on the leaderboard | Prohibited; 100–500 credits per call | **Do not build** | — |
| 46 | "Smart money is buying this reel" | No testnet data, and prohibited | **Do not build** | — |
| 47 | Nansen on Juno's testnet tokens | No data exists | Impossible | — |
| 48 | Nansen on Juno's testnet wallets | No data exists | Impossible | — |
| 49 | Pre-IPO / Tessera marks from Nansen | Not covered | Impossible | — |
| 50 | Rank the feed by "smart money attention" | Prohibited and impossible | **Do not build** | — |

---

## 6. Monad

### 6.1 What Monad offers
Catalogue in [ME §2].

- **Speed and commit states:**
  - 300 ms blocks, finality in about 600 ms.
  - Proposed/Voted/Finalized/Verified states, mapped to the `latest`/`safe`/`finalized` tags (https://docs.monad.xyz/monad-arch/consensus/block-states).
  - `monadNewHeads`/`monadLogs` carry `blockId` + `commitState`. Blocks can skip Voted, and an abandoned proposal sends no event (https://docs.monad.xyz/reference/json-rpc/overview#websocket-subscriptions).
- **RPC methods:**
  - `eth_sendRawTransactionSync`, EIP-7966 (https://docs.monad.xyz/reference/json-rpc/api#eth_sendrawtransactionsync).
  - `txpool_statusByHash`.
- **Testnet limits:** `eth_getLogs` is capped at 100 blocks; 50 rps (https://docs.monad.xyz/developer-essentials/testnet).
- **Gas and state rules:**
  - Gas is charged on the **limit**; Monad recommends a margin of about 7.5% (https://docs.monad.xyz/developer-essentials/wallet-developers).
  - **Reserve balance**: 10 MON, with k = 3 blocks (https://docs.monad.xyz/developer-essentials/reserve-balance).
  - **MIP-8 storage pages**: a cold page load costs 8,100 (https://mips.monad.xyz/MIPs/MIP-8).
- **Precompiles:**
  - P256VERIFY `0x0100`, 6,900 gas.
  - `dippedIntoReserve` `0x1001`, CALL only.
  - Staking `0x1000`.
  - https://docs.monad.xyz/developer-essentials/precompiles
- **EIP-7702 on Monad:** a delegated EOA can never dip below 10 MON, and delegated code cannot use CREATE (https://docs.monad.xyz/developer-essentials/eip-7702).
- **Other chain features:** the CLZ opcode, 128 KB contracts.
- **Mera:** passkey-PRF secp256k1 accounts, `@category-labs/mera` 0.2.0 preview (https://docs.monad.xyz/guides/mera).
- **Foundry ≥1.8 `--network monad`:** Monad gas, precompiles and staking cheatcodes (https://docs.monad.xyz/tooling-and-infra/toolkits/foundry).
- **Testnet ecosystem contracts:** WMON, USDC (EIP-2612), Uniswap v4 PoolManager (unofficial), Pyth, Pyth Entropy, Stork, Multicall3, Permit2, EntryPoint v0.7–0.9, CreateX [ME §2.11].
- **Judging weight:**
  - Monad Integration is 20% of every track score, and 20% of every sponsor-bounty score (participant-quoted rubric [ME §1]).
  - The rules ask for contract addresses or transaction hashes, and *why* Monad's capabilities are used.
- **Monad-side bounties:**
  - Mera "Best Mera-Powered UX" $2.5k: "Mera is the entire account layer — no seed phrase, no extension, no custody backend".
  - Mera "One Passkey, Many Keys" $2.5k.
  - Both exclude Privy/Dynamic [ME §1, unverified].

### 6.2 Strict audit

| Capability | Verdict | Evidence |
|---|---|---|
| Juno's own launchpad on chain 10143 | GENUINELY USED (fork); **not deployed on real testnet** | `contracts/src/JunoLaunchpad.sol`. JUNO.md's "On-chain proof" table is empty |
| viem `monadTestnet` / `monad` chains | GENUINELY USED | `lib/juno/network.ts:2,33` |
| Multicall3 batching | GENUINELY USED | `lib/juno/client.ts:25` |
| Gas estimate + 7.5% because the limit is charged | GENUINELY USED | `lib/juno/tx.ts:74,153-155` |
| `eth_sendRawTransactionSync` + measured `confirmedInMs` | GENUINELY USED (fork). **The displayed number is anvil's until real testnet** | `tx.ts:402,436,467`; `TradeSheet.tsx:504-507` |
| 100-block `getLogs` cap handled | GENUINELY USED | `swaps.ts:152` (receipt recording), `:191` (range 100), `:221` (cursor) |
| Reserve-balance handling | GENUINELY USED | Faucet spacing `faucet/route.ts:39,206`; sheet gas reserve and copy `TradeSheet.tsx:64-74`; error copy `tx.ts:616` |
| Freshly funded accounts wait 3 blocks | GENUINELY USED | `faucet/route.ts:55` |
| Pyth from its Monad contract | GENUINELY USED (forked state; fork clones go stale within minutes) | `lib/juno/pyth.ts:58,150` |
| Commit-state stream (`monadNewHeads` + `monadLogs`) | GENUINELY USED: connection and stages verified on **real testnet heads**; no Juno event streamed yet | `lib/juno/live.ts:25,194,196`; `app/api/juno/live/route.ts:23`; `LiveTape.tsx:21` (at `social.tsx:222`); `Finality.tsx:13` (at `TradeSheet.tsx:511`) |
| Counterfactual CREATE2 pair (launch ≈2.06M gas) | GENUINELY USED (fork); gas measured with Ethereum rules | `UniswapV2Graduator.sol:34,63`; `JunoToken.sol:76` |
| Foundry ≥1.8 `--network monad` | Wired, never run | `contracts/deploy.sh:121-127`; `contracts/foundry.toml:55-65`; local `forge` is 1.7.1 |
| MIP-8-aware storage layout | MISSING | Two mappings per trade: `JunoLaunchpad.sol:139-140`. A global hot slot: `:657` |
| P256VERIFY / passkeys / Mera | MISSING | `wallet.tsx:48` names `"mera"`; nothing implements it |
| EIP-7702 | MISSING (deliberately; the faucet comment explains the reserve rule) | `faucet/route.ts:33` |
| Staking precompile, `dippedIntoReserve`, CLZ | MISSING | `foundry.toml:24` is `evm_version = "cancun"` |
| FAKED | none. The "confirmed on Monad" copy on the fork is the one mislabel | — |

### 6.3 Where Monad fits, and where it would be forced
**Organic:**
- **Everything about the tap-to-confirmed moment:** the trade sheet, the Done screen's finality dots, and the feed's live tape.
- **The contracts:** a page-aware layout and no global hot slots.
- **Identity:** Mera or P256 passkeys, if the team picks Mera over Privy.
- **Creator economics:** staking parked fees, or "stake to boost" as paid curation, which is Track 03 language.
- **Graduation:** a v4 hook on the testnet PoolManager.

**Forced:**
- staking in any trading path (withdrawals take about an epoch)
- 7702 for MON-quoted buys (reserve reverts)
- claiming parallel-execution throughput wins (contention is not repriced; it only costs re-execution [ME §2.4])
- any "sub-second" claim measured on the fork

### 6.4 Fifty Monad ideas, ranked
Rows 1–20 are Monad-only: they would not exist or would not work the same on another EVM. Rows 21–36 are Monad-motivated. Rows 37–50 are weak, swappable, impossible, or claims to avoid.

| # | What it does | Monad capability | Depth | Why a Monad judge notices |
|---|---|---|---|---|
| 1 | Deploy to real testnet and publish a full lifecycle (launch, trade, fill, graduate, claim) | `contracts/deploy.sh testnet`; fill JUNO.md "On-chain proof"; MonadVision links | Core prerequisite | The rules require verifiable addresses and transactions; nothing else counts without this |
| 2 | Real confirmation times, with p50/p95 shown | `eth_sendRawTransactionSync` (`tx.ts:436`) against testnet | Core | Replaces the fork's anvil number behind "confirmed on Monad in 0.8s" |
| 3 | Juno trades in the live tape on real testnet | `monadLogs {address: launchpad}` (`live.ts:196`) | Core | Monad-only API showing Juno's own events |
| 4 | Handle abandoned proposals | Key rows by `blockId`; drop ghosts when Finalized arrives for that height with another `blockId` | Core (correctness) | Shows the team read the spec, not just the happy path |
| 5 | Commit-state gated UX | "Voted = safe" copy; share unlocks at Finalized | Core | Uses the states for decisions, not decoration |
| 6 | MIP-8 page layout | Move `_curves` into the `Pool` struct (`JunoLaunchpad.sol:139-140`); about 8k gas saved per trade [estimate] | Core | "Designed for Monad", with a measured number |
| 7 | No global hot slot in the trade path | Per-pool protocol fees instead of `protocolFees[p.quote] +=` (`JunoLaunchpad.sol:657`) | Core | A parallel-execution-aware design, stated honestly |
| 8 | Gas numbers from Monad's gas model | `foundryup` to ≥1.8; `forge test --network monad --gas-report` (`deploy.sh:121-127` is already conditional) | Core (technical) | Replaces Ethereum-rule figures like "2.06M" |
| 9 | Mera passkey account layer | `SignerSource` mode `"mera"` (`wallet.tsx:48`): `createPasskeyWithPrfOutput`, `createSecp256k1SigningSession`, `toViemAccount`; `rpId` domain with AASA/assetlinks; dev build | Core; **excludes Privy** | A $2.5k Mera bounty and the Track 04 passkey signal |
| 10 | "One passkey, many keys" | PRF salts `juno:post:v1` (post-authorship key) and `juno:vault:v1` (encrypted drafts) | Core | The second Mera bounty |
| 11 | Passkey-signed post authorship | P256VERIFY (`0x0100`) checks a WebAuthn assertion over the content hash inside `launch` | Core (Track 03) | Provenance for posts, verified on-chain |
| 12 | Gasless creator fee claim by passkey | `claimCreatorFeesBySig` with P256VERIFY; the server relays | Core | Precompile used for a real action |
| 13 | Serialize submits per wallet | The server queues one wallet's submits so two quick MON buys cannot trip the reserve revert | Core | Turns the documented k = 3 rule into behaviour, not just copy |
| 14 | Friendly reserve revert | `dippedIntoReserve()` (`0x1001`, via CALL) at the end of `buy` → `WouldDipIntoReserve` [unverified semantics] | Mid | Uses a Monad-only precompile |
| 15 | "Sent to leader" stage before Proposed | `txpool_statusByHash` | Mid | A Monad-specific RPC as a fifth dot |
| 16 | Stake to boost a post | A boost vault calls staking `0x1000` `delegate(valId)`; the feed ranks by stake; the stake stays the user's | Mid–L | Track 03's "curation paid for by those who benefit", with native yield |
| 17 | Creator vault stakes parked fees | `delegate` / `compound` / `claimRewards` | Mid–L | Native MON yield for creators |
| 18 | The validator that proposed your block | `getProposerValId()` on the Done screen | Surface, unique | — |
| 19 | 1-second candles | With Envio #5; sub-second finality gives them meaning | Mid | — |
| 20 | Parallel burst demo | N buys on N tokens landing in one block, block number shown | Mid | Shows throughput honestly (no contention claims) |
| 21 | USDC `permit` one-transaction buy | `buyWithPermit` (testnet USDC is EIP-2612 v2) | Mid | Fewer in-flight transactions under the reserve rules |
| 22 | Trade cost in dollars | Base fee (100 gwei minimum) + priority fee + Pyth MON/USD, with the whole limit charged | Surface | "Cheap enough to price a single post", shown |
| 23 | Gas limit vs gas used on the receipt | Receipt fields | Surface (educational) | — |
| 24 | Hard-coded gas for fixed-cost steps | Monad best practice; saves an estimate round trip | Small | — |
| 25 | Server push instead of 1 s polling | SSE from `live/route.ts` (the app polls at `juno-expo/lib/live.ts:63`) | Mid | — |
| 26 | Topic-filtered log subscription | `topics: [[Trade, Launched, Graduated]]` | Small | — |
| 27 | Fresh equity marks in the transaction | Pyth `updatePriceFeeds` with a Hermes payload | Mid | — |
| 28 | Graduate into Uniswap v4 with a creator-fee hook | Testnet PoolManager `0x451D…643d` (unofficial) | L | Creators keep earning after graduation |
| 29 | "Lucky buyer" drop at graduation | Pyth Entropy `0x3682…e320` | Mid / weak | — |
| 30 | Second oracle for MON/USD | Stork `0xacC0…fd62` | Weak | — |
| 31 | 7702 batching only for USDC/WMON quotes | Keeps clear of the delegated-EOA reserve rule | Risky | — |
| 32 | P-256 smart account | EntryPoint v0.7 + a WebAuthn signer; overlaps Mera | L | — |
| 33 | Same launchpad address on testnet and mainnet | CreateX `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` | Small | — |
| 34 | JSON-RPC batch for hot reads | Monad runs batches in parallel and Multicall serially | Small | — |
| 35 | Safe as the launchpad owner | Safe 1.4.1 set present on testnet | Small (security) | — |
| 36 | Mainnet deployment (chain 143) | Real money; the rules accept either network | Team decision | — |
| 37 | CLZ in `CurveMath` | Needs an Osaka `evm_version` (`foundry.toml:24` is cancun) | Weak | — |
| 38 | Fold graduators into one contract | 128 KB code limit | Weak | — |
| 39 | Link to the official faucet as a fallback | — | Weak | — |
| 40 | Execution Events SDK | Needs your own node | Weak | — |
| 41 | Epoch and validator stats page | Staking reads | Weak | — |
| 42 | A user's average confirmation time | — | Weak | — |
| 43 | Batch-launch many posts in one transaction | 30M per-transaction gas limit | Weak | — |
| 44 | Alchemy RPC for 1,000-block `getLogs` | A different sponsor; not Monad-native | Swappable | — |
| 45 | nad.fun integration | Testnet contracts have no code | Impossible | — |
| 46 | Delegate EOAs to the staking precompile | Every call reverts | **Do not build** | — |
| 47 | Claim "parallel execution makes Juno faster" | Contention is not repriced; say what is true | **Avoid the claim** | — |
| 48 | Quote any "sub-second" figure from the fork | Anvil is not Monad | **Avoid the claim** | — |
| 49 | Pitch it as "another launchpad" | Frame it as a curation market (Track 03) | Framing | — |
| 50 | Mera and Privy together | Pick one account layer | **Do not build** | — |

---

## 7. What to build next: top 10 across sponsors

Ordered by what unblocks the most score per day. Effort: **S** is at most 1 day, **M** is 2–4 days, **L** is 5 or more days.

| # | Build | Sponsor(s) | Effort | Credential / dependency |
|---|---|---|---|---|
| 1 | Deploy to real Monad testnet and run the full lifecycle; fill JUNO.md's on-chain proof with MonadVision links | Monad (unblocks all) | S, once funded | Testnet MON for operator `0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC`. Foundry ≥1.8 recommended |
| 2 | *(Freshness chip done 2026-09-24; hosting still open.)* Point the indexer at real testnet (HyperSync), host it on Envio Cloud, publish the GraphQL URL, and wire the `envioStatus` freshness chip | Envio | S–M | Envio Cloud account (GitHub app). `ENVIO_API_TOKEN` for HyperSync, or keep RPC mode. **Redeploy between 1 and 10 Oct** (the 30-day free-plan limit) |
| 3 | Re-measure `confirmedInMs` on real testnet; show Juno's own trades in the live tape; add `blockId` abandonment handling | Monad | S | #1 |
| 4 | *(Done on web 2026-09-24; native still open.)* `PrivySignerSource`: the native embedded wallet signs every launch and trade | Privy | M | Swap to `@privy-io/expo` (keep `react-auth` for `*.web.tsx`) + an Expo dev build. A Privy app client with `fun.juno.app` and scheme `juno` (the "norr" app has neither). App ID and client ID |
| 5 | Zero-MON first launch via native sponsorship (server relay) | Privy | M | TEE confirmed in the dashboard. Fee sponsorship enabled for Monad Testnet, with credits. App secret for `@privy-io/node` |
| 6 | Plans executed by a Privy signer with a policy and a 24h stateful cap; show and revoke in the app | Privy | M | Authorization key quorum (P-256), policies. Depends on #4 |
| 7 | *(Leaderboard from indexed fills done 2026-09-24; Uniswap pair indexing and candles still open.)* Leaderboard from `Position`, pair indexing after graduation, candle entities | Envio | M | #2 |
| 8 | *(Done 2026-09-24 on the fork, plus limit orders.)* `KuruGraduator` + finished venue choice + post-graduation trading (`address(0)` quotes, market orders) | Kuru | M–L | Testnet only. **Wins a Kuru prize only on Track 01.** Mainnet needs Kuru's Safe to deploy or allowlist. Ask the Kuru mentor |
| 9 | MIP-8 layout (curve inside `Pool`) + per-pool protocol fees, with Monad-model gas numbers in the README | Monad | S–M | `foundryup` to ≥1.8. Redeploy (do it before #1 if it lands in time) |
| 10 | Nansen "proven trader" composite from a Privy-SIWE-linked mainnet wallet, surfaced as "proven traders are buying this reel" | Nansen + Privy + Envio | M | Nansen API key (free plan: 100 credits once + 10/day, enough without labels), **or** x402 with Monad-mainnet USDC (real money; the team's call). File the redistribution approval if smart-money inputs are used. Depends on #4 |

**Decisions only the team can make:**
1. **Track 03 or Track 01.** Only Track 01 makes the Kuru and Perpl work count for prizes.
2. **Privy or Mera** as the account layer. The two bounties are mutually exclusive, and Agora needs Mera.
3. **Whether to spend real mainnet USDC** on Nansen x402.
4. **Whether to deploy to mainnet at all.** The rules accept testnet.
