# How complete is Juno?

Measured 2026-09-24, from things that were run rather than read: the test
suites, a search of the code for stand-ins, the app in Chrome against a fork of
Monad testnet, the database rows those runs wrote, and the operator wallet's
balance on real Monad testnet.

## What 100% means

Juno is finished when a Metropolis judge can check every claim the README makes,
on Monad, and the submission is complete. Five parts, weighted by how much
they decide that:

| Part | Weight | 100% means |
|---|---|---|
| A. The product works | 35% | Every case in [`TEST-PLAN.md`](TEST-PLAN.md) passes: 49 cases across the shell, wallet, launch, feed, coin page, Kuru, Trade tab, profile, API and test suites |
| B. It is on Monad | 25% | Contracts deployed and verified on Monad testnet; a full lifecycle there with MonadVision links; the indexer and the live tape following that deployment |
| C. The chosen sponsors are really used | 15% | Monad, Kuru, Envio, Privy and Nansen each **GENUINELY USED** (strict definition in [`SPONSOR-AUDIT.md`](SPONSOR-AUDIT.md)) on a real network |
| D. The submission is complete | 15% | The checklist in [`METROPOLIS.md`](METROPOLIS.md), as ten equal items: (1) contracts deployed and verified, (2) lifecycle links in `JUNO.md`, (3) API and web app hosted, (4) demo video, (5) pitch video, (6) cover, (7) project profile, (8) track and bounties entered, (9) public repo, (10) open licence, AI disclosure and provenance |
| E. Engineering holds up | 10% | Every suite passes; both apps typecheck; CI runs them; no mocks, stubs or placeholders outside tests |

## First measurement: 54%

| Part | Score | Evidence |
|---|---|---|
| A. Product | **92%** (45 of 49) | Passing, or failed and then fixed and re-checked in Chrome: 45. Open: **B5** (a Privy login needs a person), **D3** (reels need a video launch), **D4** (the live tape follows real testnet, so fork trades cannot appear) and **H4** (fixed, but the Chrome re-check was interrupted) |
| B. On Monad | **15%** | Real testnet: the commit-state stream (`connected: true` to `wss://testnet-rpc.monad.xyz`), Pyth and Perpl reads. Not on testnet: every Juno contract and transaction. The deployer `0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC` holds **0 MON** (checked with `eth_getBalance` against `testnet-rpc.monad.xyz`) |
| C. Sponsors | **48%** | Kuru 0.7 (real Kuru contracts, on a fork). Monad 0.6 (stream on real testnet, writes on a fork). Envio 0.6 (runs and serves the app; not hosted). Privy 0.5 (web signer wired, the provider loads from `auth.privy.io`; no login completed). Nansen 0 (no code; the API answers 402 without a key) |
| D. Submission | **10%** (1 of 10) | Done: item 10 (MIT licence, AI disclosure and provenance in the README; commits run across the window). Not done: items 1–9 |
| E. Engineering | **90%** | `forge test`: 55 passed (the Kuru fork suite is opt-in and passed separately). Root `vitest`: 328 passed, 6 skipped. Indexer: 8 passed. Both `tsc --noEmit` clean. CI runs contracts, app and Expo types, **but not the indexer tests**. Stand-in search: `mock`, `stub`, `fake`, `dummy`, `placeholder`, `TODO` appear only in tests, input hints, the empty-state component and comments saying a value is *not* a stand-in. No Slither run |

Weighted: 0.35 × 92 + 0.25 × 15 + 0.15 × 48 + 0.15 × 10 + 0.10 × 90 = **54%**.

**What the number says.** The app itself is nearly done (A and E). The
unfinished part is getting it in front of judges on Monad (B and D), and almost
all of that waits on one thing: testnet MON for the deployer. After that the
deploy is one command (`contracts/deploy.sh testnet`).

## Gaps, and who can close them

| Gap | Part | Points | Who |
|---|---|---|---|
| Deploy to testnet, verify, run the lifecycle, point the indexer at it | B, C, D | about 27 | The team funds the deployer (faucet.monad.xyz needs a login and a CAPTCHA); then the deploy, lifecycle and indexer switch are Claude's to run |
| Host the API and the web build | D | 1.5 | The team: "don't deploy" stands until they say otherwise |
| Demo video, pitch video, cover, profile, track entry, public repo | D | 9 | The team |
| A Privy login and a Privy-signed trade | A, C | about 2 | A person with an email or social account |
| Nansen | C | 3 | A Nansen API key; x402 would spend real USDC |
| D3 reels, H4 re-check | A | about 1.5 | Claude, once the disk has room |
| Indexer tests in CI; Slither | E | about 1 | Claude |

## Closing the gaps

*(Updated as each one closes.)*

1. **H4, the trader page** (A): now lists the wallet's trades, and every trade
   row says what was paid rather than the mark after the trade. Re-checked in
   Chrome. A: 46 of 49.
2. **Found while measuring, fixed:** the profile's "Trades" figure counted the
   points of the value chart (H1); the Network rows called the fork "Monad
   testnet". Both fixed and re-checked in Chrome.
3. **Kuru idea #3 / feature #75:** a Kuru coin's market address is shown from
   launch. On a coin taken from launch to graduation, the address shown before
   was the market Kuru opened.
4. **D3, reels** (A): a real video reel plays full-screen with its market
   dock. A: 47 of 49. The two left need a person (B5, Privy) or real testnet
   (D4, the live tape).
5. **Engineering** (E): the indexer's typecheck was failing in its tests;
   fixed. CI now runs the indexer (codegen, typecheck, tests) and Slither.
   Slither found one real trap, fixed in the contract with a test. Every CI
   command was run locally; CI itself has never run, because the repo has no
   GitHub remote yet. E: 95%.
6. **Regression sweep** through the whole app at phone size after these
   changes. It found and fixed five more issues: price impact counting the
   fee twice, a sell hint larger than the seller's holding, finality polling
   without end, React errors from the chart's SVG hit bands, and a
   deprecation warning from `pointerEvents` props. A fresh session through
   every screen now logs no error and no warning. The only 5xx seen was the
   faucet's deliberate 503 when it is empty, shown to the person in words.

## Final measurement: 56%

Re-measured over the whole project after the gaps above were closed.

| Part | Score | Evidence |
|---|---|---|
| A. Product | **96%** (47 of 49) | Every case passes, or failed and was fixed and re-checked, except **B5** (a Privy login needs a person with an account) and **D4** (the live tape follows real Monad testnet, where Juno is not deployed) |
| B. On Monad | **15%** | Unchanged. The commit-state stream, Pyth and Perpl reads are real testnet. The deployer still holds 0 MON, so no Juno contract or transaction is on testnet |
| C. Sponsors | **48%** | Unchanged in kind: Kuru is deeper (the market's address from launch) but still on a fork; Envio still unhosted; Privy still without a completed login; Nansen still without a key |
| D. Submission | **10%** | Unchanged: only item 10 |
| E. Engineering | **95%** | 56 contract tests and the 7 Kuru fork tests; 304 unit tests; 8 indexer tests; three typechecks clean; Slither clean at medium and above; CI configured for all of it. Not 100% because CI has never run: there is no GitHub remote |

Weighted: 0.35 × 96 + 0.25 × 15 + 0.15 × 48 + 0.15 × 10 + 0.10 × 95 = **56%**
(54% at the first measurement).

**Why it moved only two points.** Everything that could be closed from inside
the repo was closed. What remains needs one of four things:

1. **Testnet MON for `0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC`** (about 27
   points: deploy, verify, run the lifecycle, point the indexer at it, and the
   Monad parts of C and D). After funding, this is a command, not a project.
2. **The team's own deliverables** (9 points): both videos, the cover, the
   project profile, the track entry, a public repo.
3. **A person's Privy login** (about 2 points).
4. **A Nansen API key** (3 points); paying through x402 would spend real USDC.


---

## Second run (evening of 2026-09-24): measured again from nothing

The fork, databases and indexer were rebuilt empty, and every case was run
again through the web app in the built-in browser at phone size: nothing
reused from the earlier passes.

**The checklist grew by three claims the README makes that the test plan did
not cover:** (X1) stock trackers carry a current Pyth mark; (X4) the Expo app
runs on iOS and Android; (X5) a fresh clone sets itself up with the commands
under *Run it*. Part A is now 52 items.

### First number this run: 52%

| Part | Score | What failed or could not be verified |
|---|---|---|
| A. Product | 87% (45 of 52) | **D1**: a photo posted a moment earlier drew as a blank grey box in the feed. **G2**: the Stocks list called a 125-day-old Pyth mark the stock's "live" price. **X1**: `PYTH_API_KEY` is present in `.env.local` but empty, so there is no fresh equity mark. **X4, X5**: not verifiable this run; a native build or a fresh `npm install` does not fit in the 1.2 GB the disk had left. **B5** (a Privy login) and **D4** (the live tape on testnet) are still blocked |
| B. On Monad | 15% | The deployer and the script key (the same address) and the faucet key all hold 0 MON on testnet; no other funded key exists in the project |
| C. Sponsors | 48% | Unchanged |
| D. Submission | 10% | Unchanged |
| E. Engineering | 95% | Every suite green; the launchpad integration suite also passed against the fork (5 tests). CI has never run: no remote |

Stand-in search over tracked code: every hit is a comment saying a value is
*not* a stand-in.

### Closed in this run, each re-checked in the browser

| Gap | Fix | Re-check |
|---|---|---|
| D1: new photos blank in the feed | The upload keeps the bytes it pinned, the IPFS route serves from memory and skips gateway error pages, and images retry (`ded6f5c`) | A photo launched through the Post screen drew at once; the earlier blank one drew too; a repeat load went from 4 s to 6 ms |
| Tabs showed stale data (a new reel missing from Reels, holdings unchanged after a trade) | Feed, Reels, Trade and Profile re-read on focus (`a8f8f74`) | A second reel launched with Reels open appeared after switching away and back |
| Kuru order list contradicted its own receipt; raw-float price hint | List re-read while the receipt shows; hint to four figures (`04f63ae`) | The list read "Bid 300.00 DUSKBOOK @ 0.001 MON" beside "Bid placed" |
| G2: stale mark shown as live | "Pyth, 125d old", uncoloured gap, honest header (`e1eda94`) | Stocks list and the coin's NAV band both say stale |
| Perps receipt quoted the mark, not the fill | Fill price from `PositionOpened.pricePNS` (`21e5f25`) | "at $2,654.33", equal to the position's entry |

### Re-measured over the whole checklist after the fixes

Every screen was visited again in a fresh session: no console error or
warning, no broken image, no `NaN`, no request answering 4xx or 5xx (68
requests). All suites passed again: 56 contract tests, 328 unit and
integration tests, 8 indexer tests, three typechecks.

### Final number: 54%

| Part | Score |
|---|---|
| A. Product | 90% (47 of 52): open are B5, D4, X1, X4, X5 |
| B. On Monad | 15% |
| C. Sponsors | 48% |
| D. Submission | 10% |
| E. Engineering | 95% |

0.35 × 90 + 0.25 × 15 + 0.15 × 48 + 0.15 × 10 + 0.10 × 95 = **54%**. On the
first run's 49-case checklist the same app scores 96% for A, which is 56%
overall; the difference is the three claims added, not a regression.

**What is left, and why.**

- **B (25 points at stake) and most of C and D:** testnet MON for
  `0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC`. Nothing in the project can
  fund it; the faucet needs a login and a CAPTCHA.
- **X1:** a Pyth Hermes API key (`PYTH_API_KEY` is empty).
- **B5:** a person's Privy login.
- **X4, X5:** disk space. The Mac's internal disk is being filled by
  another project's anvil (`infra/monad-fork`, 18 GB in
  `~/.foundry/anvil/tmp`).
- **D items and hosting:** the team's videos, cover, profile, track entry, a
  public repo, and a decision to deploy.
- **Beyond the checklist:** a coin that graduates into Uniswap v2 cannot be
  traded in the app (feature #40). No README claim covers it, so it is not
  counted, but it is the largest product gap left.

## Third run (2026-09-29): after the Solana 1.1.0 migration

Measured against the same 52-item checklist and the same weights. What
changed is in [`PLAN.md`](../PLAN.md)'s Status table, each row with its
evidence.

| Part | Score | Since the last run |
|---|---|---|
| A. Product | **94%** (49 of 52) | **X4 closed**: an iOS release build (simulator) and an Android release APK (emulator, API 35) both reach the feed against the API; on iOS a device-key wallet took MON from the app's faucet and bought a graduated coin on Uniswap v2 ("confirmed on a local fork of Monad testnet in 0.7s"). **X5 closed**: a fresh clone set up as the README says passes every suite — and found that `next build` had been failing since 24 Sep (Next's file tracer and a `let … = null` in the faucet route), now fixed. Open: **B5** (a Privy login needs a person; the native SDK now starts and its sheet opens), **D4** (the live tape follows real testnet), **X1** (no `PYTH_API_KEY`) |
| B. On Monad | **15%** | Unchanged: the deployer still holds 0 MON. A mainnet deploy was simulated read-only (`docs/MAINNET.md`) |
| C. Sponsors | **48%** | Unchanged under the strict definition. Privy is now wired on iOS and Android too, but no login has been completed on any platform |
| D. Submission | **10%** | Unchanged: item 10 only. Ready but not done: `docs/SUBMISSION.md`, the v1.1.0 artifacts, `scripts/publish-github.sh` for item 9 |
| E. Engineering | **95%** | 74 Foundry tests + 7 Kuru fork tests, 312 unit tests, 10 indexer tests, three typechecks, Slither clean at medium, the production build, fixtures without drift — all run locally at `0654f98`. CI has still never run: there is no remote |

0.35 × 94 + 0.25 × 15 + 0.15 × 48 + 0.15 × 10 + 0.10 × 95 = **55%**.

Beyond the checklist, the largest product gap the last run named — a coin
that graduated into Uniswap v2 could not be traded in the app — is closed
(`JunoSwapRouter`, `lib/juno/v2.ts`), and exact-out buys came across from the
Solana app.

**What is left is the same list, and none of it can be done from here:**
testnet MON for the deployer (B, most of C and D), a person's Privy login
(B5), a Pyth key (X1), the Monad bundle id allowed in Privy, and the team's
own submission items — repository, videos, cover, profile, track entry,
hosting.
