# Zero-mock test plan: Juno on Monad (6 Oct 2026)

Every component and flow, what "correct" means for each, and its status, run
for real. Statuses are updated in place.

**Result (6 Oct, final build `e318842`): 0 FAIL.** Everything that can run
without the owner passed:
- the app regression: 59 of 60 checks, with 0 console or network problems;
- the API: 88 of 88 calls;
- every screen at 375 px: 43 of 43 (50 of 50 on 7 Oct, with the new creator profile, which `tests/e2e/profile.mjs` also covers: 12 of 12);
- passkeys and sealed drafts;
- sponsor features X1, X3, X5, X6, X9 and X11;
- the suites and gates.

On 7 Oct, after the creator profile, the same runs again: the app regression 59 of 60 (B7 as before) with 0 problems, the API 88 of 88, passkeys and sealed drafts with 0 problems, every screen 50 of 50, and the profile e2e 12 of 12. The profile work also fixed holdings pictures: the portfolio API now serves `ipfs://` media through Juno's own route, as coins already did.

UNTESTED items each name their blocker: an owner key or account, a second
device, or the testnet go.

## Rules

- **Nothing mocked in the running product.** No fixture modes, stubs or
  fallback data. A missing credential shows an honest "not configured" state,
  and its items are UNTESTED with the exact dependency named. (Unit tests may
  use test doubles; they are listed under K and are not counted as browser
  passes.)
- **On-chain means real contracts and real signed transactions** on an anvil
  fork of Monad testnet (`:8555`, `--prune-history 300`). Juno's real testnet
  deployment, and Perpl, Kuru, AUSD, Pyth and Chainlink's feeds, are all
  forked from testnet. **Monad testnet itself is on hold**, so items that need
  it are UNTESTED (*awaiting testnet go*).
- **The app under test is a production build:** `next build` + `next start`
  on `:3150` and the Expo web export on `:8183`. Data is a fresh Postgres and
  Mongo, seeded only through the API with real signed transactions
  (`scripts/juno-demo.ts`).
- **In a real browser:** Google Chrome, driven headlessly through Playwright's
  `chrome` channel. The Claude in Chrome extension was not reachable from
  this session on 6 Oct, so it was not used. Every item checks the console
  (no error or warning) and the network (no failed or 4xx/5xx request,
  except the one the item is about).
- PASS means the result matches "correct" exactly. UNTESTED is never counted
  as PASS.

## Components

| Kind | Components |
|---|---|
| Screens (13 routes) | `/`, `/social`, `/reels`, `/trade` (Pre-IPO, Stocks, Memes, Kuru, Perps + Risk, Traders), `/post`, `/profile` (Holdings, Watching, Plans, Activity, About), `/coin/[token]` (Activity, Holders, Comments, Details), `/post/[id]`, `/trader/[wallet]`, not-found |
| API (43 routes) | `config coins coins/[token] feed posts posts/[id] comments likes follow saved watchlist plans profiles profiles/privy depth leaderboard portfolio/[wallet] pools live index tessera faucet metadata upload drafts tx/{swap,launch,claim,graduate,submit,balance} kuru/{order,orders,cancel,withdraw} perps perps/{account,deposit,withdraw,open,close,faucet,risk} autopilot autopilot/{send,run}` |
| Contracts | `JunoLaunchpad`, `JunoToken`, `UniswapV2Graduator`, `KuruGraduator`, `JunoSwapRouter` (deployed on testnet, forked); `JunoNavOracle` (deployed on the fork) |
| External | Pyth (Monad contract), Tessera API, Perpl (contracts + API), Kuru (contracts), Agora AUSD faucet, Chainlink USDC/USD feed and MockKeystoneForwarder, Pinata/IPFS, Privy, Mera (WebAuthn PRF), Envio, Chainlink CRE CLI, MetaMask `mm`, Kimi |

## Items

Items A–K use the IDs and "correct means" definitions in
[`E2E-PLAN.md`](E2E-PLAN.md), which this plan builds on. Their statuses below
are from this run. Items S, P, X and T are new.

### A–H. The app, end to end (`.juno/rerun.mjs`, fresh visitor)

| IDs | Covers | Status |
|---|---|---|
| A1–A7 | Landing, Get Started, tab bar, unknown route, deep-link reload, web frame, API page redirect | PASS (7/7) |
| B1–B6, B9–B10 | Device wallet, faucet (pays, refuses a repeat, empty), names and rules, Privy identity route, copy address | PASS (8/8): the faucet paid exactly 0.5 MON, refused the fourth drip with 429 and a sentence, and said where to go when empty |
| B7 | Privy modal opens | UNTESTED here: Privy opens only on its allowed origins, and this build has no Privy app id (the button is absent, so the check times out). Passed on the hosted app on 5 Oct. |
| C1–C9 | Composer, validation, photo launch (Pinata upload + metadata + one transaction), first buy, Kuru venue, reel launch with poster, venue and preset rules, the launch in the feed | PASS (9/9): photo and metadata pinned to IPFS, one launch transaction, the first buy's `balanceOf` equal to the quote |
| D1–D11 | Feed, stories, like, comment, follow and Following, share, reels, post page, live tape, buy from the feed | PASS (11/11): the live tape's block equals the receipt's |
| E1–E20 | Coin page, chart ranges, buy (spend and exact), sell 50%, size hint, over balance, close mid-flow, activity, holders, comments, details, depth, creator fees, watch, alert, plan, fill and graduate (v2), trade on the pair, unknown coin | PASS (20/20): balance deltas equal the receipts, exact-out buys exactly 100,000, sells exactly half and a quarter |
| F1–F4 | Graduate into Kuru, trade on Kuru, limit orders (place, cancel, withdraw), Kuru history | PASS (4/4): a new Kuru market with a bid and ask; a resting bid placed, cancelled and withdrawn, leaving Kuru holding nothing |
| G1–G7 | Pre-IPO (Tessera), Stocks (Pyth), Memes, Perps markets, Perps trade (deposit, open, close, withdraw on Perpl), Traders, tracker band warning | PASS (7/7): a 2x BTC long on Perpl's forked contracts opened, closed and withdrawn |
| H1–H4 | Portfolio, Watching, Plans, trader page | PASS (4/4): the portfolio's value equals the API's to the cent |

### I. Every API method, from the app's origin (`.juno/api-rerun.mjs`, 88 calls)

| ID | Correct means | Status |
|---|---|---|
| I1–I16 + faucet | Each route answers what E2E-PLAN.md I1–I16 say, including refusals (400/401/404/409) with a sentence | PASS: 88/88 calls |

### S. Every screen at 375 px (`tests/e2e/walk.mjs`)

| ID | Correct means | Status |
|---|---|---|
| S1 | All 50 screens and tabs (43 before the 7 Oct profile) render content, with no sideways overflow, no `NaN`/`undefined`, no console error and no failed request | PASS: 43/43 on the final build |

### R. Creator profile (`tests/e2e/profile.mjs`, 7 Oct)

| ID | Correct means | Status |
|---|---|---|
| R1 | Visitor view at 1440 and 390 px: @handle, Posts, Followers, Following, Follow; no Edit profile | PASS |
| R2 | Own view at 1440 and 390 px: Edit profile, Share profile, Posts, Reels, Coins, Backed and Wallet tabs; no Follow | PASS |
| R3 | The Posts grid has one square tile per post the API lists, photos and reels together (each reel with its badge), three to a row, each with its coin's price change; the header's Posts count equals the number of tiles | PASS |
| R4 | Reels shows one tile per reel; Coins lists every coin launched; Backed shows the leaderboard record and other creators' coins held | PASS |
| R5 | A tile opens its coin (click and touch tap) | PASS |
| R6 | Edit profile saves a bio and link signed by the wallet; the server stores exactly them; a visitor sees both; a `javascript:` link cannot be saved | PASS |
| R7 | A new wallet's own profile: "No posts yet" with Post your first; an address that is not one: "No such wallet" | PASS |
| R8 | No console error or warning, and no failed request, in any of the above | PASS |

### P. Passkeys (Mera)

| ID | Correct means | Status |
|---|---|---|
| P1 | Create a passkey account in one prompt; only `{address, credentialId}` stored | PASS: 1 passkey use; storage holds the wallet choice and `{address, credentialId}` only |
| P2 | Signing in the session asks for nothing; End session locks; the next signature asks exactly once | PASS: +0 uses in the session; locked; +1 after End session, and the session reopened |
| P3 | Storage wiped → "Sign in with my passkey" → the same address | PASS: the same address and name |
| P4 | Sealed draft: the server holds only the vault (no plaintext); wiped and signed back in, it opens and fills the form; delete leaves 0 | PASS: the server held the vault only, with no plaintext; after a wipe and sign-in it opened and filled the form; delete left 0 |
| P5 | The same passkey on a second real device | UNTESTED: needs a second device with a synced passkey (Chrome's virtual authenticator cannot export a PRF secret) |
| P6 | Mera in the iOS and Android apps | UNTESTED: needs an Apple Developer team id with Associated Domains, and the Android release certificate (see `MOBILE-PASSKEYS.md`) |

### X. Sponsor features

| ID | Correct means | Status |
|---|---|---|
| X1 | Perpl bot: deposit; open on the paid side when funding passes entry; close when it fades; the kill switch holds; real `execOrder` on the fork | PASS: deposited, opened a BTC short through `execOrder`, closed it when the exit config said funding had faded; with the kill switch on it did nothing |
| X2 | Perpl risk view (Perps → Risk): funding history, skew, liquidation distance | PASS (S1, G4); with a position, on real testnet on 5 Oct (`E2E-HOSTED.md`) |
| X3 | Chainlink CRE `juno-nav`: a report built by the workflow's code from live Tessera, Pyth and Chainlink readings is delivered through Monad's MockKeystoneForwarder; `JunoNavOracle.navOf` holds it; the coin page shows "Attested on Monad by Chainlink CRE" | PASS: `cre/juno-nav/fork-attest.ts` on the fork, `onReport` succeeded, `navOf` returned the attested points, and the OPENAIX page showed the line (`.juno/cre-line.mjs`) |
| X4 | `cre workflow simulate juno-nav` | UNTESTED: needs `cre login` (the owner's CRE account) |
| X5 | MetaMask plugin: installs in `mm` 7.0.0; `mm juno markets` and `mm juno coin` answer from the API | PASS |
| X6 | Plugin trade path: buy on a curve, buy on a v2 pair, sell 50% exactly, sell 100% to zero, Juno refuses a sell of nothing, portfolio | PASS: 11/11 (`mm-plugin-juno/scripts/fork-e2e.ts`). The executor is a fork key standing in for MetaMask's wallet service; see X7. |
| X7 | `mm juno buy` through MetaMask's own executor | UNTESTED: needs `mm login` (a MetaMask Agent Wallet account) |
| X8 | `mm juno ask` on Kimi | UNTESTED: needs `MOONSHOT_API_KEY` (and `mm login`, which `mm` checks first). The command refuses to run without the key; there is no stand-in model in the plugin. |
| X9 | Autopilot without a Privy signer: the Plans tab shows "Not set up" and offers nothing | PASS (S1, Profile · Plans) |
| X10 | Autopilot live: policy written in Privy, signer added, a plan bought through Privy with `sponsor: true` | UNTESTED: needs `PRIVY_SIGNER_ID` and `PRIVY_AUTHORIZATION_KEY` (`npm run juno:privy-setup`) and the testnet go. Privy's wallet API broadcasts to Monad testnet itself. |
| X11 | Kuru orders without an indexer: a resting bid is listed, cancelled, withdrawn | PASS (F3) |
| X12 | Privy sign-in and signing in the app | UNTESTED here: Privy opens only on its allowed origin (`localhost:3000`, which another project holds today). Passed on the hosted app on 5 Oct. |

### J. Integrations

| ID | Correct means | Status |
|---|---|---|
| J1 | Envio serves full history and the app's numbers equal the chain | UNTESTED on this fork (no local Envio; it needs Docker plus an index from the launchpad's deploy block). Hosted Envio passed on 5 Oct. The app's no-indexer path is tested instead (receipts + log tail, honestly labelled). |
| J2 | Tessera marks equal Tessera's API | PASS (G1) |
| J3 | Pyth MON/USD from Monad's contract; equity marks labelled with their age | PASS (G2) |
| J4 | Pinata upload: bytes come back identical | PASS (C3) |
| J5 | Kuru and Perpl read from the real forked contracts | PASS (F1–F4, G5) |
| J6 | Fresh equity marks | UNTESTED: needs `PYTH_API_KEY` |

### K. Suites and gates

| ID | Correct means | Status |
|---|---|---|
| K1 | `forge test` | PASS: 83 passed, 1 skipped (the env-gated Kuru fork suite) |
| K2 | Root unit tests, typechecks, production build | PASS: 409 tests in the root suite (380 of them the unit tests CI runs); `tsc` clean in the root, the app, the plugin and the CRE workflow; `next build` and the web export built |
| K3 | Indexer `pnpm test` | PASS: 10/10 |
| K4 | No mock, stub or fallback data in shipped code | PASS: the grep over `lib`, `app`, the Expo app, the plugin, the CRE workflow and `scripts` finds only comments that say "never fake", the contract parity fixtures' generator, the Privy types module (not loaded at runtime), and Chainlink's MockKeystoneForwarder by name |
| K5 | Plugin tests, CRE workflow tests, WASM build | PASS: plugin 20, CRE 7, the workflow compiles to WASM |
| K6 | Slither, secret scan, nothing secret tracked | PASS: Slither 0 medium or high; no key, JWT, mnemonic or `.env` file tracked |
| K7 | `npm run demo:local` from a clean state: fork, fresh databases, production API, seed, web app; `stop` frees every port | PASS: exit 0 in 3½ minutes; 14 coins seeded through the API (one graduated into Uniswap v2, one into Kuru); `tests/e2e/walk.mjs` against it 43/43; `stop` left nothing listening |

### T. Monad testnet (on hold)

| ID | Item | Status |
|---|---|---|
| T1 | Hosted app redeployed on HEAD; the post-deploy smoke test (`DEPLOY-LATER.md`) | UNTESTED: awaiting testnet go |
| T2 | `JunoNavOracle` on testnet; CRE simulate with `--broadcast` | UNTESTED: awaiting testnet go and `cre login` |
| T3 | Autopilot live with sponsorship | UNTESTED: awaiting testnet go and the Privy signer |
| T4 | A Kuru-venue coin graduated on hosted testnet | UNTESTED: awaiting testnet go (MON) |
