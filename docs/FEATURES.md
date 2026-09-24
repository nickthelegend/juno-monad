# Juno: 100 feature ideas, ranked, and what was built

Written 2026-09-24 for Monad Metropolis (build window closes 13 Oct 2026).
Every idea is scored **Impact × Feasibility × Fit**, each 1–5, so the maximum
is 125. *Impact* is what it does for a user or a judge. *Feasibility* is how
much of it can be finished and proven before the deadline without real money
or accounts the team does not have. *Fit* is how well it serves Juno's claim,
"every post is a market", and the sponsors the team picked (Monad, Envio,
Kuru, Privy, Nansen).

Status:

- **BUILT**: in the code, exercised against a Monad testnet fork (or real
  testnet where noted), with the evidence named.
- **PARTIAL**: some of it exists; the gap is named.
- **NOT BUILT**: not started.
- **BLOCKED**: needs something outside the repo (an account, a key, money, a
  mainnet listing). The blocker is named.

Nothing marked BUILT is a mock. "Verified" means it was run: by Foundry
against forked Kuru contracts, by the API against the fork, or in the web app.
Nothing is on real Monad testnet yet, because the deployer
(`0x019E…CaaC`) has no MON; see [Blockers](#blockers).

## Categories

- **F**: product functionality
- **S**: sponsor depth (Monad, Envio, Kuru, Privy, Nansen)
- **D**: design and motion
- **P**: production readiness

## The list, highest score first

| # | Idea | Cat | I | Fe | Fit | Score | Status | Evidence / gap |
|---|---|---|---|---|---|---|---|---|
| 1 | Buy and sell a post from the feed and the reels dock | F | 5 | 5 | 5 | 125 | BUILT | `TradeSheet.tsx`, `QuickTrade.tsx` |
| 2 | Creator chooses the graduation venue: Uniswap v2 or Kuru | S | 5 | 5 | 5 | 125 | BUILT | `JunoLaunchpad.sol` `graduatorAllowed`; venue picker in `post.tsx` |
| 3 | Creator fee claim | F | 5 | 5 | 5 | 125 | BUILT | `FeesCard` on the coin page; `tx/claim` |
| 4 | Envio indexer as the source of history, holders, positions and ranking | S | 5 | 5 | 5 | 125 | BUILT | `indexer/`; `lib/juno/envio.ts` |
| 5 | Graduation opens the coin's own Kuru market at the curve's final price | S | 5 | 5 | 5 | 125 | BUILT | `KuruGraduator.sol`; `test/KuruGraduator.t.sol` (fork, live Kuru); ask = curve top in the E2E |
| 6 | One-transaction launch: token, sixteen-range curve, venue lock and optional first buy | F | 5 | 5 | 5 | 125 | BUILT | `JunoLaunchpad.launch`; `app/(tabs)/post.tsx` |
| 7 | Server-built, device-signed transactions via `eth_sendRawTransactionSync` with the measured confirm time shown | S | 5 | 5 | 5 | 125 | BUILT | `lib/juno/tx.ts`; "confirmed on Monad in 0.9s" in the trade sheet (fork) |
| 8 | Trade a Kuru-graduated coin in the app (free quote, market orders) | S | 5 | 5 | 5 | 125 | BUILT | `lib/juno/kuru.ts`; bought 2 MON and sold 19,940 tokens from the web app |
| 9 | Built-in testnet faucet that respects Monad's reserve and settle rules | S | 4 | 5 | 5 | 100 | BUILT | `app/api/juno/faucet/route.ts` |
| 10 | Complete holder list (transfers included) with indexer freshness | S | 4 | 5 | 5 | 100 | BUILT | `listPoolHolders`; "current to block N" caption |
| 11 | Contract verification on MonadVision (Sourcify) | P | 4 | 5 | 5 | 100 | PARTIAL | wired in `deploy.sh`; runs with the real deploy |
| 12 | Counterfactual Uniswap pair: locked at launch, deployed at graduation | S | 4 | 5 | 5 | 100 | BUILT | `UniswapV2Graduator.sol`; halves launch gas |
| 13 | Curve depth chart and "size before 1% move" suggester | F | 4 | 5 | 5 | 100 | BUILT | `app/api/juno/depth`, trade sheet |
| 14 | Curve shape previews on the launch screen | D | 4 | 5 | 5 | 100 | BUILT | `CurvePreview.tsx` |
| 15 | Exponential fee decay against snipers | F | 4 | 5 | 5 | 100 | BUILT | `JunoLaunchpad` fee maths, fuzz tests |
| 16 | Foundry fuzz invariants (no free round trip, solvency) | P | 4 | 5 | 5 | 100 | BUILT | `test/JunoLaunchpad.t.sol` |
| 17 | Graduated coins marked at their venue (pair reserves / Kuru mid) | F | 4 | 5 | 5 | 100 | BUILT | `lib/juno/mark.ts` |
| 18 | Honest partial states (never a zero we did not measure) | D | 4 | 5 | 5 | 100 | BUILT | `partial` flags through history, holders, portfolio |
| 19 | Kuru fills carry into the same position and cost basis | S | 4 | 5 | 5 | 100 | BUILT | `indexer/src/EventHandlers.ts` `applyFill`; indexer test |
| 20 | Leaderboard from the indexer, curve and Kuru fills | S | 4 | 5 | 5 | 100 | BUILT | `lib/juno/leaderboard.ts` `indexedHistories` |
| 21 | Live commit-state tape (Proposed → Voted → Finalized) from Monad's WebSocket | S | 4 | 5 | 5 | 100 | BUILT | `lib/juno/live.ts`, `LiveTape.tsx`; verified against real testnet heads |
| 22 | Per-trade finality timeline | S | 4 | 5 | 5 | 100 | BUILT | `Finality.tsx` |
| 23 | Permissionless graduation button (anyone can send it on) | F | 4 | 5 | 5 | 100 | BUILT | coin page "Graduate" / "Open on Kuru" |
| 24 | Portfolio with average cost, realised and unrealised P&L | F | 5 | 5 | 4 | 100 | BUILT | `lib/juno/portfolio.ts`, profile screen |
| 25 | Privy embedded wallet signs every transaction (web) | S | 5 | 4 | 5 | 100 | BUILT, login unverified | `lib/privy.web.tsx`; provider and login modal verified; a full login needs a real account |
| 26 | Real testnet deployment and one full lifecycle with MonadVision links | P | 5 | 4 | 5 | 100 | BLOCKED | deployer has 0 MON; `contracts/deploy.sh testnet` is ready |
| 27 | Reels: full-screen video, double-tap like, inline market | F | 5 | 5 | 4 | 100 | BUILT | `app/(tabs)/reels.tsx` |
| 28 | Verified X handle on profiles through Privy | S | 4 | 5 | 5 | 100 | BUILT, login unverified | `lib/juno/privy.ts`, `POST profiles/privy` (401 on a bad token verified) |
| 29 | Comments, likes, follows, saved posts | F | 4 | 5 | 4 | 80 | BUILT | Mongo-backed routes |
| 30 | Graduation moment: a sheet that shows the market opening | D | 4 | 4 | 5 | 80 | NOT BUILT | today a pill and a link |
| 31 | Limit orders on Kuru-graduated coins | S | 4 | 4 | 5 | 80 | NOT BUILT | `addBuyOrder`/`addSellOrder` from the MarginAccount balance |
| 32 | Creator first buy in the launch screen | F | 3 | 5 | 5 | 75 | PARTIAL | the API and CLI support `firstBuy`; the screen does not offer it |
| 33 | Curve builder ↔ contract parity fixtures | P | 3 | 5 | 5 | 75 | BUILT | `test/PresetParity.t.sol` |
| 34 | Kuru bid/ask/spread on the coin page | D | 3 | 5 | 5 | 75 | BUILT | coin page graduated block |
| 35 | Recurring buy plans executed by a Privy server signer with a policy | S | 5 | 3 | 5 | 75 | PARTIAL | plans are stored (`app/api/juno/plans`); execution needs a Privy key quorum |
| 36 | Refuse at launch what a venue could not list (price range, quote) | S | 3 | 5 | 5 | 75 | BUILT | `IJunoGraduator.prepare` gets the migration amounts |
| 37 | Squat-proof Kuru graduation (reuse a pre-deployed market) | S | 3 | 5 | 5 | 75 | BUILT | `test_graduate_reusesAMarketSomeoneDeployedFirst` |
| 38 | API host deploy | P | 4 | 4 | 4 | 64 | NOT BUILT | the user asked not to deploy; DEPLOY.md covers Railway/Render/Fly |
| 39 | Onboarding: fund, name, first buy in three taps | D | 4 | 4 | 4 | 64 | PARTIAL | faucet and names exist; not stitched into one flow |
| 40 | Trade Uniswap-graduated coins in the app (router swap) | F | 4 | 4 | 4 | 64 | NOT BUILT | today the app says "trades on its Uniswap v2 pair" |
| 41 | Web deploy of the app | P | 4 | 4 | 4 | 64 | NOT BUILT | the user asked not to deploy; `npm run export:web` is ready |
| 42 | CI: contracts and app on every push | P | 3 | 5 | 4 | 60 | BUILT | `.github/workflows/ci.yml` |
| 43 | Candles and line chart with volume | D | 3 | 5 | 4 | 60 | BUILT | `Candles.tsx`, `PriceLine.tsx` |
| 44 | Candles from indexed fills (server-side OHLC) | S | 3 | 5 | 4 | 60 | PARTIAL | the app builds candles client-side (`lib/candles.ts`) from fills |
| 45 | Creator earnings over time | F | 3 | 4 | 5 | 60 | PARTIAL | the claimable balance and lifetime total are shown; no series |
| 46 | Empty states that say why | D | 3 | 5 | 4 | 60 | BUILT | holders, activity, portfolio |
| 47 | Envio Cloud deployment of the indexer | S | 4 | 3 | 5 | 60 | BLOCKED | needs the team's Envio account |
| 48 | Faucet key sealed at rest, never pasted | P | 3 | 5 | 4 | 60 | BUILT | `lib/sealed-keys.ts` |
| 49 | Gas measured under Monad's model (`--network monad`, Foundry ≥ 1.8) | S | 3 | 4 | 5 | 60 | NOT BUILT | local Foundry is 1.7.x |
| 50 | Kuru book depth view (limit levels + synthesised vault levels) | S | 3 | 4 | 5 | 60 | NOT BUILT | `getL2Book` + `getVaultParams` |
| 51 | Kuru market fills on the live tape | S | 3 | 4 | 5 | 60 | NOT BUILT | the tape follows the launchpad only |
| 52 | Landing page for first visit | D | 3 | 5 | 4 | 60 | BUILT | `app/index.tsx` |
| 53 | Multicall3 batching for list views | S | 3 | 5 | 4 | 60 | BUILT | `lib/juno/client.ts` |
| 54 | Names claimed with an EIP-191 signature | F | 3 | 5 | 4 | 60 | BUILT | `lib/juno/profiles.ts` |
| 55 | Phone-width frame on the web build | D | 3 | 5 | 4 | 60 | BUILT | `app/_layout.tsx` `PhoneFrame` |
| 56 | Pre-IPO trackers marked against Tessera | F | 4 | 5 | 3 | 60 | BUILT | `lib/juno/tessera.ts`, Trade tab |
| 57 | Share links with page metadata | F | 3 | 5 | 4 | 60 | BUILT | `juno-expo/scripts/web-meta.mjs` |
| 58 | Stock trackers with a Pyth NAV band | F | 4 | 5 | 3 | 60 | BUILT | `lib/juno/pyth.ts`, `NavBand` |
| 59 | Stop-loss / take-profit on graduated coins via `KuruForwarder.executePriceDependent` | S | 4 | 3 | 5 | 60 | NOT BUILT | needs a relayer and a margin balance |
| 60 | Trader pages | F | 3 | 5 | 4 | 60 | BUILT | `app/trader/[wallet].tsx` |
| 61 | Watchlist with price alerts | F | 3 | 5 | 4 | 60 | PARTIAL | alerts resolve when viewed; there is no push |
| 62 | Gasless first launch through Privy gas sponsorship | S | 5 | 2 | 5 | 50 | BLOCKED | dashboard: TEE mode, Monad testnet sponsorship, credits |
| 63 | Indexer freshness banner app-wide | S | 2 | 5 | 5 | 50 | PARTIAL | on the holders tab only |
| 64 | Venue badge on feed cards ("On Kuru") | D | 2 | 5 | 5 | 50 | BUILT | `FeedCard.tsx` |
| 65 | Perps on majors (BTC, ETH, SOL, MON) through Perpl | S | 4 | 3 | 4 | 48 | IN PROGRESS | spec in `docs/research/research-perpl.md`; testnet collateral (AUSD) has no public faucet |
| 66 | Search coins and creators | F | 3 | 4 | 4 | 48 | NOT BUILT |  |
| 67 | "Back this creator": deposit into the coin's Kuru vault | S | 3 | 3 | 5 | 45 | NOT BUILT | `KuruAMMVault.deposit` |
| 68 | HyperSync as the indexer source | S | 3 | 3 | 5 | 45 | BLOCKED | needs an Envio API token; RPC sync works meanwhile |
| 69 | Launch in USDC for stock-shaped curves | F | 3 | 5 | 3 | 45 | BUILT | `quoteToken` on `tx/launch` |
| 70 | Heart burst on double-tap | D | 2 | 5 | 4 | 40 | BUILT | `HeartBurst.tsx` |
| 71 | Indexer tests in CI | P | 2 | 5 | 4 | 40 | NOT BUILT | the indexer's vitest suite runs locally |
| 72 | Kuru fork test in CI (opt-in, pinned block) | P | 2 | 4 | 5 | 40 | NOT BUILT | runs locally with `KURU_FORK_TEST=1` |
| 73 | Privy on iOS/Android (`@privy-io/expo`) | S | 4 | 2 | 5 | 40 | BLOCKED | needs an Expo development build and the app's bundle id on the Privy app |
| 74 | Push notification when someone buys your post | F | 4 | 2 | 5 | 40 | NOT BUILT | needs Expo push credentials |
| 75 | Show the Kuru market's future address before graduation | S | 2 | 4 | 5 | 40 | NOT BUILT | `Router.computeAddress` at the planned params |
| 76 | Accessibility roles and states on controls | D | 3 | 4 | 3 | 36 | PARTIAL | radios, tabs and buttons carry roles; not audited |
| 77 | Custom curve designer (drag sixteen weights) | F | 3 | 3 | 4 | 36 | NOT BUILT | four presets today |
| 78 | Moderation of reels (report + hide) | F | 3 | 4 | 3 | 36 | NOT BUILT |  |
| 79 | Rate limits on write routes | P | 3 | 4 | 3 | 36 | PARTIAL | the faucet is rate-limited; other routes are not |
| 80 | Static analysis (Slither) on the contracts | P | 3 | 4 | 3 | 36 | NOT BUILT |  |
| 81 | Nansen "proven trader" score from a linked mainnet wallet | S | 4 | 2 | 4 | 32 | BLOCKED | needs a Nansen API key; x402 would spend real USDC |
| 82 | Gas snapshots in CI | P | 2 | 5 | 3 | 30 | NOT BUILT |  |
| 83 | Skeletons while loading | D | 2 | 5 | 3 | 30 | BUILT | `Skeleton` in `kit.tsx` |
| 84 | Copy the top trader's next buy | F | 3 | 3 | 3 | 27 | NOT BUILT |  |
| 85 | Mainnet listing of Juno markets on Kuru | S | 5 | 1 | 5 | 25 | BLOCKED | Kuru's mainnet Router is owner-only; needs Kuru's team |
| 86 | EIP-7702 batching (approve + sell in one) | S | 3 | 2 | 4 | 24 | NOT BUILT | device keys would need a delegation contract |
| 87 | Price ticks that animate between values | D | 2 | 4 | 3 | 24 | NOT BUILT |  |
| 88 | Pyth push script to refresh equity marks on-chain | S | 2 | 4 | 3 | 24 | BUILT | `scripts/pyth-push.ts` |
| 89 | Load test against the public RPC's limits | P | 2 | 3 | 3 | 18 | NOT BUILT |  |
| 90 | Mera passkey accounts | S | 3 | 2 | 3 | 18 | NOT BUILT | conflicts with Privy for bounties |
| 91 | Nansen token screener: what is moving on Monad mainnet, beside Juno's feed | S | 3 | 2 | 3 | 18 | BLOCKED | needs a Nansen API key |
| 92 | TestFlight / Play internal builds | P | 3 | 2 | 3 | 18 | BLOCKED | Apple and Google developer accounts |
| 93 | Error monitoring (Sentry or similar) | P | 2 | 4 | 2 | 16 | NOT BUILT |  |
| 94 | Structured request logs | P | 2 | 4 | 2 | 16 | NOT BUILT |  |
| 95 | Aurora intents: fund from another chain | S | 2 | 2 | 2 | 8 | NOT BUILT | not a chosen sponsor |
| 96 | Chainlink CRE workflow for Tessera marks | S | 2 | 2 | 2 | 8 | NOT BUILT | not a chosen sponsor |
| 97 | Localised copy | D | 1 | 3 | 2 | 6 | NOT BUILT |  |
| 98 | Perpl builder code on perps orders | S | 2 | 1 | 3 | 6 | BLOCKED | Perpl must register the builder; the API path needs an origin allowlist |
| 99 | Staking precompile: stake MON from the profile | S | 1 | 3 | 2 | 6 | NOT BUILT | off-theme |
| 100 | Dark mode | D | 1 | 4 | 1 | 4 | NOT BUILT | the palette is pinned to light on purpose |

## What was built in this pass

In order, each committed on its own:

1. **The Kuru venue** (`881246c`): graduator, per-launch venue choice, deploy
   wiring, fork tests against Kuru's live contracts, API quoting and orders,
   indexer entities, app UI. Verified end to end through the API and the web app.
2. **Privy on the web** (`c5c7370`): embedded wallet as a signer, verified X
   handles. Provider and login modal verified; a full login needs a person.
3. **Venue marks and the indexed leaderboard** (`5cd1c66`): graduated coins
   priced at their venue; Kuru fills in positions; leaderboard from Envio;
   indexer freshness on the holders tab.

## Blockers

| Blocker | Unblocks | Who |
|---|---|---|
| Testnet MON for `0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC` (about 1 MON for the deploy, more to run the lifecycle and fund the faucet) | #26, #11, every "on real testnet" claim | the team, from faucet.monad.xyz |
| A Privy login on `http://localhost:3000` | #25 and #28 end to end | the team |
| Privy dashboard: gas sponsorship, key quorum | #35, #62 | the team |
| Nansen API key | #81, #91 | the team |
| Envio account / API token | #47, #68 | the team |
| Testnet AUSD for Perpl | #65 (trading on real testnet) | Perpl or Agora |
