# Juno on Monad — migration plan

**Written:** 2026-09-29. **Deadline:** Monad Metropolis, 13 Oct 2026.

Self-contained: a builder agent should be able to execute any task below
without the conversation that produced it.

**What "migrate from Solana" means here.** This repository was ported from the
Solana Juno repo (`/Volumes/Extreme SSD/Projects/zorr-solana`, branch `juno`)
at commit `db5f8e1` (23 Sep). The Solana app then gained about forty commits
on 25–26 Sep, ending at release v1.1.0 (`b9b897f`). This plan brings every
one of those changes that applies to Monad across, and closes the Monad
repo's own open gaps from [`docs/COMPLETION.md`](docs/COMPLETION.md).

The EVM port to Arbitrum (`/Volumes/Extreme SSD/Projects/juno-arbitrum`, made
from Solana v1.1.0 on 28 Sep) already translated several of these features
to EVM (native Privy EVM wallets, demo data, film tooling), so it is the
reference implementation where one exists.

Status tags: **DONE** (implemented and verified, evidence given), **IN
PROGRESS**, **NOT STARTED**, **BLOCKED** (reason and unblock step given),
**N/A** (Solana-only, with the reason).

---

## 0. Inventory: Solana `db5f8e1..b9b897f`, classified

| Solana change | Monad |
|---|---|
| Launch log with receipts on the Post screen; blank composer after a launch; iPhone photos picked as JPEG | Port → 1.1 |
| Trade receipt: hash and landing time on the Done sheet | Port → 1.2 |
| Tracker outside its band / stale reference warned in the trade sheet | Port → 1.3 |
| Depth chart on the coin page (Details) | Port → 1.4 |
| Company logos on Pre-IPO (bundled) and Stocks (by ticker, with fallback) | Port → 1.5 |
| Light status bar over Reels | Port → 1.6 |
| A holding opens its coin | Port → 1.7 |
| App client retries a GET once on a dropped connection | Port → 1.8 |
| Read routes wait out a brief RPC refusal (`junoRead`, `retryWhenBusy`) | Port → 1.9 |
| Tessera page lists markets from the registry even when a read fails | Port → 1.10 |
| Upload accepts an image whose dimensions cannot be read | Port → 1.11 |
| Day change of a coin younger than a day, from its opening price | Port → 1.12 |
| `tight-nav` owns a narrow range (1.5x default, 3x max); preset comparison script | Port → 1.13 |
| Exact-out buys ("get exactly N tokens") | Port → 2.1, 3.1 (needs a contract function) |
| Privy embedded wallets on iOS and Android, email sign-in sheet | Port → 4 (EVM version from juno-arbitrum) |
| Demo activity from named demo wallets; real Pexels reels | Port → 6 |
| Demo film pipeline (HyperFrames, voice, music) and shot list | Port → 10.3 |
| Submission text, sponsor-track reasoning | Port → 10.2 |
| Release with builds and download links | Port → 9 |
| Creator claims fees on the coin page | Already on Monad (test plan E9) |
| Valuations in billions (`bigMoney`) | Already on Monad |
| DBC fee removed from fill prices; opening fee maths | N/A — Monad's `Trade` event carries the post-trade curve price, which has no fee in it |
| Batched `getMultipleAccounts` pool reads | N/A — Monad reads pools with one multicall already |
| Links to Jupiter for mainnet DBC tokens | N/A — MonadVision links, already present |
| TSLAx (xStocks) as a DBC quote with a token badge | N/A — no badged-quote concept on Monad; USDC and MON are the quotes |
| Mainnet proof runs on Solana | Monad equivalent → 7.3 (runbook only; mainnet is the user's to run) |

## 1. Open gaps carried from the Monad repo

| Gap | Task |
|---|---|
| A coin that graduates into Uniswap v2 cannot be traded in the app | 2.2, 3.2 |
| Native iOS/Android builds never verified | 5 |
| A fresh clone's setup never verified | 5.3 |
| No public GitHub repo; CI has never run | 9 |
| Nothing on Monad testnet (deployer holds 0 MON) | 7 — BLOCKED |
| API and web app not hosted | 8 — BLOCKED on 7 |
| `PYTH_API_KEY` empty; no Nansen key; Envio not hosted; Privy login needs a person | USER_ACTION |

---

## Phases

### Phase 1 — Solana parity without contract changes

- **1.1** Post screen: a launch log (IPFS pins, the launch transaction, the
  listing, each with its receipt and time; transactions link to MonadVision);
  the composer clears after a successful launch; the image picker asks iOS
  for a compatible JPEG instead of HEIC. *Verified by* a launch in the web
  app showing every row, and the composer empty on return.
- **1.2** Trade sheet Done state shows `tx 0x1234…abcd · 14:02:11`.
- **1.3** Trade sheet warns when a tracker is outside its band or its
  reference is stale, before signing.
- **1.4** `DepthChart` in the coin page's Details tab, from `/api/juno/depth`.
- **1.5** Logos: Pre-IPO bundles OpenAI, Kalshi and SpaceX; Stocks loads the
  company logo by ticker and falls back to the ticker tile on error.
- **1.6** Light status bar while Reels is focused.
- **1.7** Profile holdings open their coin.
- **1.8** `juno-expo/lib/api.ts`: one quiet retry for a GET that never got a
  response (not for timeouts, never for POSTs).
- **1.9** `lib/juno/api.ts`: `retryWhenBusy` and `junoRead`; read routes use
  it. Nothing that sends a transaction is retried.
- **1.10** `/api/juno/tessera`: markets come from registry rows; figures are
  null when a read fails.
- **1.11** `/api/juno/upload`: unreadable image metadata gives null
  dimensions instead of failing a pinned upload.
- **1.12** `changeWithin(…, opening)`: a coin younger than the window
  measures from the curve's start price. *Verified by* a unit test and a
  fresh coin showing a day change instead of "—".
- **1.13** Presets get `defaultCapMultiple` (content/thin-name/ipo-book 25x,
  tight-nav 1.5x) and `maxCapMultiple` (tight-nav 3x), enforced by the
  builder and the launch route; `scripts/juno-compare-presets.ts` prints the
  four presets on one controlled config; table in JUNO.md.

### Phase 2 — Contracts

- **2.1** `JunoLaunchpad.buyExactOut(token, baseOut, maxQuoteIn, recipient,
  deadline)` and `quoteBuyExactOut`: walks the curve by base out, charges the
  fee on the net quote, refunds unused native quote, reverts `Slippage` above
  the cap and `InsufficientLiquidity` past the curve's supply. Foundry unit
  and fuzz tests (exact-out never gives fewer tokens than asked, never costs
  more than a same-state exact-in buy of the same size, rounding favours the
  pool). Slither clean at medium.
- **2.2** `JunoSwapRouter`: buy and sell a graduated coin against its Uniswap
  v2 pair atomically (wrap/unwrap MON, `getPair`, reserve maths with the 0.3%
  fee, deadline, min-out). Tests against the vendored v2 factory, including
  a graduation followed by buys and sells. Added to `Deploy.s.sol`.
- **2.3** Redeploy to the fork; ABI export; `forge test` and the Kuru fork
  suite green.

### Phase 3 — Server and app for Phase 2

- **3.1** Exact-out: `amountOut` on `/api/juno/tx/swap`; the trade sheet's
  token chip switches between "spend" and "get exactly"; the receipt shows
  the actual cost.
- **3.2** Post-graduation Uniswap v2 trading: quotes from pair reserves, buys
  and sells through the router (a sell adds an approval step), the coin page
  and the trade sheet offer trading again, fills are recorded and indexed.
  *Verified by* a curve filled, graduated, then bought and sold in the app.

### Phase 4 — Privy on iOS and Android

- **4.1** `@privy-io/expo` with an embedded **EVM** wallet (email OTP),
  modelled on juno-arbitrum's `app/lib/privy.native.tsx`; `SignInSheet`;
  `wallet.tsx` signs transactions and EIP-191 messages through Privy when
  signed in; the web build keeps its current path.
- **4.2** Bundle id `app.launch.junomonad`, scheme `junomonad`. Uses the
  "juno" Privy app (`cmuh8o5…`) and its native client, which already has
  Ethereum embedded wallets on. *USER_ACTION:* allow the bundle id and scheme
  on that client.

### Phase 5 — Native builds and a fresh clone

- **5.1** iOS Simulator release build launches and reaches the feed against
  the local API.
- **5.2** Android APK builds (arm64); installs and launches in the emulator.
- **5.3** A fresh clone to a temporary directory sets itself up with the
  README's *Run it* steps; fix whatever it hits.

### Phase 6 — Demo data

- **6.1** `scripts/juno-demo.ts`: named `demo_` wallets launch the four Pexels
  reels (same IPFS content as the Solana demo), photo posts, and the three
  Pre-IPO and two stock trackers, then trade between them, all through the
  API like the phone. Fork first; the same command runs on testnet.

### Phase 7 — Monad testnet  ·  BLOCKED on MON

- **7.1** `contracts/deploy.sh testnet` (needs about 1.1 MON at 102 gwei).
- **7.2** Verify on MonadVision/Sourcify; lifecycle proof (launch, buy, sell,
  claim, fill, graduate into Uniswap v2 and into Kuru, trade after each);
  `JUNO.md` on-chain proof section; indexer pointed at the deployment.
- **7.3** `docs/MAINNET.md`: the mainnet runbook, for the user to run.

Unblock: send ~10 MON to `0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC`
(faucet.monad.xyz, or Alchemy's / QuickNode's faucet). Checked 29 Sep: the
agents faucet (`agents.devnads.com`) is down (its Railway app returns 404).

### Phase 8 — Hosting  ·  BLOCKED on 7

- **8.1** Deploy scripts for the API and the web build (Vercel), secrets
  script; run once the testnet deployment exists.

### Phase 9 — Repository and release

- **9.1** Secret scan of the whole history; create the GitHub repo, push,
  let CI run and fix what fails.
- **9.2** Release v1.0.0 with the APK, the iOS Simulator build and checksums.

### Phase 10 — Documentation and submission

- **10.1** README, JUNO.md, DEPLOY.md brought up to date.
- **10.2** `docs/SUBMISSION.md` for Metropolis (Track 03), sponsor reasoning.
- **10.3** Demo film tooling ported with Monad narration and a shot list.

### Phase 11 — Audit loop

- Re-run every suite and the whole test plan; re-measure completion; search
  for stand-ins; create a new phase for anything fixable.

---

## Status

| Task | Status | Evidence |
|---|---|---|
| 1.1 Launch log, blank composer, JPEG | DONE | Web launch of LANTERN: "Photo pinned to IPFS · QmZKrq…", "Token metadata pinned", "Market opened … tx 0x32a3… · 0.3s", "Listed on Juno"; on return every field empty and first buy back to None. JPEG mode is iOS-only (checked in 5.1) |
| 1.2 Trade receipt | DONE | "tx 0xf74b49…5774a4 · 02:48:40 AM" on the Done sheet |
| 1.3 Band warning | DONE | AAPLX: "AAPL's price is stale, so this curve can't be checked…"; OPENAI after a $60 buy: "This curve is 4.0% above T-OpenAI's mark, outside its 2% band. A buy here pays more than the reference." |
| 1.4 Depth chart | DONE | Details tab: "23.6% buying $85.69 · 69.2% buying $1.06k · 89.2% buying $6.95k" |
| 1.5 Logos | DONE | OpenAI/Kalshi/SpaceX bundled PNGs load (512 px); AAPL from the logo endpoint (100 px); an unknown ticker 404s to the ticker tile |
| 1.6 Light status bar on Reels | DONE in code | Native-only; checked on the simulator in 5.1 |
| 1.7 Holdings open their coin | DONE | "Open Lantern festival" → `/coin/0x16CB…` |
| 1.8 GET retry | DONE | A Tessera GET forced to fail at the network: retried, page drew the marks, no error shown |
| 1.9 Read retries | DONE | `tests/unit/juno-api-retry.test.ts` (5); every GET that reads the chain and every build uses it |
| 1.10 Tessera from registry | DONE | Route lists rows; null figures typed through to the card ("—", "progress not read yet") |
| 1.11 Upload tolerance | DONE | `sharp().metadata()` failure gives null dimensions |
| 1.12 Day change from opening | DONE | Two unit tests; hydratePool passes the curve's start price |
| 1.13 Preset ranges | DONE | tight-nav launches at 1.5x (script: "graduates at 1500.00 USDC FDV"); >3x refused (unit test); comparison table in JUNO.md; fixtures and parity tests regenerated (17 pass) |
