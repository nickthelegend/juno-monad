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

