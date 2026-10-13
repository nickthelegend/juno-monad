# Judge round 2: an independent judge on the live app, the repo and the portal copy

A fresh subagent that had not seen the code or the chat judged Juno from:
- the live URL;
- the public repo;
- `docs/PORTAL-COPY.md`;
- the official rubric.

It pressed the in-app faucet once and made one 0.1 MON buy. Its verdict is below, lightly abridged (screenshot filenames removed). The fixes and the re-judge follow it.

## Round 1 verdict (13 Oct, 20:10 IST)

# Juno: judge verdict (Monad Metropolis, Track 01)

I checked everything from scratch in about 20 minutes. I used a real Chrome via Playwright at 1440x900 (`-d`) and 390x844 (`-m`), plus the Monad testnet RPC, BlockVision Sourcify and the public repo. I pressed the faucet once and made one 0.1 MON buy.

## Main track score

| Criterion (20% each) | Score | Reason |
|---|---|---|
| Product quality | 7 | The core loop works for a brand-new visitor: create wallet → faucet (0.5 MON in 3.0 s) → buy → receipt in about 2 s, with no console errors. But desktop is just a phone column with two side rails, and every market is a toy: the graduated Kuru coin has a $0.30 market cap and 3 trades. |
| Technical excellence | 8 | All 8 claimed tx hashes returned `status 0x1`. The 5 core contracts have bytecode and Sourcify (BlockVision) returns 200 for each. The repo has Foundry contracts with 7 test files, a CRE workflow with a test, an Envio indexer with tests, an Expo app, and a perpl-bot with a unit test. The last 5 CI runs are green. |
| Monad integration | 8 | The receipt shows real numbers (executed 346 ms, final 576 ms). The block strip shows Proposed/Voted/Finalized/Verified live. The faucet and gas display are Monad-aware. The P256 precompile claim did not show up on chain. |
| Track fit | 8 | It is squarely onchain trading: curves, Kuru order books, Perpl perps and pre-IPO trackers. |
| Innovation | 6 | Social posts as coins is Zora/pump.fun. Graduating each post into its own Kuru order book is the genuinely new part. Seven sponsor integrations read as bounty farming rather than one sharp idea. |
| **Weighted total** | **7.4 / 10** | |

## Bounties

| Bounty | Req (40) | Tech (30) | Monad (20) | Innov (10) | Weighted | One-line reason |
|---|---|---|---|---|---|---|
| Kuru: New Assets & Markets | 8 | 8 | 8 | 7 | **7.9** | Graduation tx `0x04de4115…5bda` has 21 logs from the launchpad, `KuruGraduator` and market `0xD2175f…a144`. The coin page shows the Kuru bid/ask. Real, but the market is tiny. |
| Kuru: Consumer Trading App | 6 | 7 | 7 | 6 | **6.5** | The Kuru buy and sell both succeed and both target the market. "Evidence of demand" is generic; the only real usage is 3 trades from `demo_*` accounts. |
| Perpl: Analytics / Risk | 7 | 6 | 6 | 5 | **6.3** | The Risk tab shows funding a year, cost per $1k, premium and volatility per market. The long tx succeeds. I could not see per-position risk without a position. The bar sparklines have no axes. |
| Perpl: Best use of API | 6 | 6 | 5 | 5 | **5.7** | The bot and its unit test exist. No proof shows it running. |
| Agora: Best Mobile Trading App | 4 | 6 | 5 | 4 | **4.8** | `juno-expo/` exists, but there is no build, store link or APK. The AUSD tx succeeds. A judge cannot install the mobile app. |
| Mera: Best UX | 5 | 6 | 5 | 6 | **5.4** | The "passkey buy" tx comes from a plain EOA with no code. The P256 precompile is not used in that tx. Four sign-in buttons on Profile weaken the "one passkey" story. |
| Chainlink CRE | 6 | 7 | 6 | 7 | **6.4** | The report tx goes through the MockKeystoneForwarder path used by `simulate --broadcast` from a dev EOA, not a deployed DON workflow. The badge says "2h ago" although the config cron is every 10 min. |
| Privy | 5 | 5 | 4 | 5 | **4.8** | Not verifiable from outside. The repo marks the dashboard as "partial". No autopilot or policy tx. |
| Envio | 7 | 7 | 6 | 5 | **6.6** | `indexer/config.yaml` has dynamic registration and order/trade events. No public GraphQL URL is given, so "0 blocks behind" can't be checked. |

## Claims I couldn't verify
- **P256 precompile:** the cited passkey tx comes from a codeless EOA and calls the launchpad directly. If P256 is used, it is off-chain or in an `eth_call`, with no linked evidence.
- **"Envio hosted, 0 blocks behind":** no public indexer endpoint is given. The API root 307-redirects to the app, and `/api/health` returns 404.
- **Privy autopilot through policies and a key-quorum signer:** no tx or screen I could reach.
- **"An Expo app (iOS, Android, web)":** the source is there, but there is no runnable build or link.
- **Perpl bot caps, kill switch and restart-safe state:** code and a unit test only, no run evidence.
- **CRE "a cron reads Tessera…":** a simulation broadcast through the mock forwarder, not a live CRE deployment, and the attestation is 2 h stale.
- **416/579 ms:** this is the app's own measurement. My buy reported 346/576 ms, which is consistent.

## Broken or confusing steps
- **Buy sheet:** it never says which coin you are buying.
- **Buy sheet presets:** dollars before the wallet exists, then percentages, then MON. Three units in one flow.
- **Landing (390):** "The Monad WebSocket closed; it reopens on the next look." is shown to a first-time visitor.
- **Profile without a wallet:** "0x5d…fda4 · 3 posts · a real profile". Whose profile is that?
- **Profile:** four competing sign-in buttons.
- **Feed search (390):** the result row was hidden for "gradk", and "openai" returned nothing in that run. It worked at 1440.
- **OpenAI tracker:** "+0.00% past day" above a rising chart.
- **Kuru coin:** "+2412.50% past day" over a flat line with a vertical cliff.
- **Trade tabs (390):** the last tab is clipped.

## Dense or ugly screens
- **Desktop at every route:** a 480 px column with block-stat rails on both sides. The same rail block is repeated on every page.
- **Perps → Risk:** bar sparklines with no axis or legend.
- **Pre-IPO cards:** too many figures in one card.
- **Feed:** the first two posts are titled "Graduation, Kuru" and "Graduation, Uniswap v2". Test fixtures lead the product.

## The reason I'd vote no
It is a well-engineered demo of an economy with no economy. The headline Kuru graduation produced a market worth $0.30, with 3 trades, all from `demo_*` wallets. The sponsor integrations are spread thin: the mobile app can't be installed, CRE was simulated through a mock forwarder, and the passkey "P256 precompile" tx is a plain EOA.

## Top 5 fixes
1. Lead the feed with real-looking posts, not the fixtures, and name the coin at the top of the Buy sheet.
2. Seed the graduated Kuru market with maker orders, and show a book ladder and limit orders on the coin page.
3. Make the mobile and passkey claims checkable, or drop them.
4. Run CRE for real, or say plainly that it is simulated. Show the attested NAV and premium.
5. Give desktop a real layout, unify the buy presets, and reconnect silently instead of showing "WebSocket closed".

## Fixes after round 1 (13 Oct, 20:10–20:25 IST)
- **Claims made checkable** (4e07d8d):
  - the P256 check is an `eth_call`, not a tx;
  - CRE ran as `simulate --broadcast` through the mock forwarder;
  - Envio is checkable through the API's `holdersSource` and `indexer.behind` fields;
  - Privy moved from "working" to "partial";
  - the mobile claim says how a judge can run it.
- **UI** (5d77a87):
  - the buy sheet names the coin, and its quick sizes stay in one unit;
  - "reconnecting…" replaces the socket's closing message;
  - rails show only beside the feed and markets;
  - the example profile is labelled, and the sign-in options shrink to one primary, one secondary and two links;
  - Segmented tabs scroll at 390 px.

## Round 2 verdict (13 Oct, 20:25 IST), a fresh judge with the same brief, summarised

| Criterion | Round 1 | Round 2 |
|---|---|---|
| Product quality | 7 | 7 |
| Technical excellence | 8 | 8 (it docked for CI being red at that moment; see below) |
| Monad integration | 8 | 8 (its own buy: 414 ms executed, 683 ms final) |
| Track fit | 8 | 8 |
| Innovation | 6 | 6 |
| **Weighted** | **7.4** | **7.4** |

Bounties moved:
- **Mera:** 5.4 → 6.7. The P256 claim now matches what can be checked.
- **Envio:** 6.6 → 7.0. The named endpoint verified.
- **Chainlink CRE:** 6.4 → 5.9. The simulation is now stated plainly.
- **Kuru:** 7.9 → 7.2 and 6.5 → 6.4. The graduated market is small.
- **Perpl:** about the same.
- **Agora:** about the same.

Its reason to vote no: every market and trade is the team's own seed data, and the graduated Kuru market is worth $0.30.

## Fixes after round 2 (20:25–20:40 IST)
- **CI:** the quick-sizes test update had been left out of 5d77a87. It was committed in the next commit, and CI is green again.
- **Pre-IPO pages:** the CRE badge shows the attested NAV and premium as numbers ("NAV $812.79 · attested by Chainlink CRE · 0.35% under").
- **No-wallet profile:** the "Sign in with Privy" link is gone. It silently created a device wallet, because the hosted origin is not yet allowed in Privy.
- **Buy sheet:** the reserve note is plain words.
- **Portal copy:** it points at where `eth_sendRawTransactionSync` is used (the server's submit path).

## Not fixable tonight
Each of these needs the owner, MON or keys:
- **Real outside users:** the seed data is labelled `demo_`.
- **A deep Kuru market:** needs MON to fill a larger curve and rest maker orders.
- **A deployed CRE DON workflow:** needs CRE deploy access.
- **Privy on the hosted origin:** the owner's dashboard.
- **A store or TestFlight build for the Agora claim.**
