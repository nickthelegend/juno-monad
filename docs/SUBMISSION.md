# Metropolis submission: Track 01, Onchain Finance & Trading

Deadline: **13 Oct 2026, 11:59 pm ET** (<https://hackathon.monad.xyz>).
Fields in [brackets] are filled in once the thing exists. Nothing here is
claimed before it is true. Each status says where a feature has run:

- **testnet** means on real Monad testnet, in the hosted app;
- **fork** means real contracts and real signed transactions on an anvil fork
  of Monad testnet (the testnet hold of 6 Oct);
- **owner** means it waits on a key or account only the owner holds.

Every item, with its result, is in
[TEST-PLAN-ZERO-MOCK.md](TEST-PLAN-ZERO-MOCK.md).

## Project

| Field | Value |
|---|---|
| Project | Juno: every post is a market |
| One-liner | Post a photo or a reel and it launches its own bonding curve on Monad. When the curve fills it graduates into its own Kuru order-book market (or a Uniswap v2 pair), with perps on Perpl and pre-IPO trackers beside it. |
| Primary track | 01, Onchain Finance & Trading |
| Repo | <https://github.com/nickthelegend/juno-monad> (MIT) |
| Live app | <https://juno-monad-app.vercel.app> (API <https://juno-api-production-04ea.up.railway.app>). Hosted build of 5 Oct; the 6 Oct features go up when the testnet hold lifts ([DEPLOY-LATER.md](DEPLOY-LATER.md)). |
| Run it locally | `npm run demo:local`: the whole stack on a fork of Monad testnet, seeded, in one command (README) |
| Judge logins | None needed. Profile → *Sign with* → **Passkey** makes an account in one prompt; Profile → Wallet → *Get testnet MON* funds it. |
| Contracts (Monad testnet) | `JunoLaunchpad` `0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81`, `UniswapV2Graduator` `0x6924937d7DDDD7D1c931Dc7a9779bD32F807FeAA`, `KuruGraduator` `0xBeFD5740896D157A3E9821939e5ba213BEf50F99`, `JunoSwapRouter` `0x648c6E84F779Cf20730Db26d49B7B950ca256366`, v2 factory `0xA81f5D4884d56B7F648bCAb6e6fcdc8b8f54fb81`. All are verified on MonadVision ([`10143.json`](../contracts/deployments/10143.json)). `JunoNavOracle`: [address after the testnet go]. |
| On-chain proof | `$GENESIS` [`0x1409…6360`](https://testnet.monadvision.com/token/0x14092A529e2e5EB4DECB4a1828f6aFa72e026360): launched, bought, sold, filled, [graduated](https://testnet.monadvision.com/tx/0x799309cc168b1b1ea248d04fb9b9c6b90972fc7090bf42765a1cf52dc0907ed4) and traded on its pair ([E2E-PLAN.md](E2E-PLAN.md), phase 6). A Perpl round trip with Agora AUSD on 5 Oct ([E2E-HOSTED.md](E2E-HOSTED.md)). |
| Builds | Web (live). Native iOS and Android from `juno-expo/` (README, *Install it*). |
| Technical demo (≤ 3 min) | [video link] (script below) |
| Founder pitch (≤ 2 min) | [video link] |
| Cover graphic (≤ 3 MB) | [file] |

## Pitch

Creator coins end on a curve. Juno's don't. Every post is a market on Monad
the moment it is published: one transaction, a bonding curve shaped for what
it is. When enough people buy in, the post opens **its own Kuru order book**,
seeded from its raise with the liquidity locked, so a market outlives the app.
The same wallet trades **Perpl perps** with **Agora AUSD**, and **pre-IPO and
stock trackers** that are marked against Tessera and Pyth. Their NAV is
attested on Monad by **Chainlink CRE**. You sign in with one **passkey**
(Mera). Plans buy themselves through **Privy** under a policy, with gas paid
by Privy. An agent can trade all of it from the **MetaMask Agent Wallet**,
planned by **Kimi**.

## Why Monad

- **A buy that lands mid-scroll.** `eth_sendRawTransactionSync` returns the
  receipt in the same call. The receipt shows its measured confirmation time,
  and the live tape follows each trade through Proposed → Voted → Finalized.
- **One transaction per launch, about 2M gas:** the token, the curve, the
  lock on its future pair and the creator's first buy. That is cheap enough
  to price a single post.
- **Native venues:** Kuru's order book, Perpl's perps and Agora's AUSD are on
  Monad, so a coin can graduate into a real market and sit beside perps.
- **Monad's rules handled:** gas is billed on the limit, so limits are
  estimates plus a measured margin; the faucet respects the 10 MON sender
  reserve; history doesn't depend on the public RPC's 100-block `eth_getLogs`.

## Judging criteria (20% each)

- **Product quality.** A phone-first feed of reels and photo posts, each with
  a price, a chart and a buy button. iOS, Android and web come from one Expo
  codebase. All 50 screens and tabs pass at 375 px with no console or
  network errors (`tests/e2e/walk.mjs`).
- **Technical excellence.**
  - Contracts: Juno's own `JunoLaunchpad`, `CurveMath`, `JunoToken`, the
    Uniswap v2 and Kuru graduators, `JunoSwapRouter` and `JunoNavOracle`.
    83 Foundry tests with fuzzed invariants, a Solidity ↔ TypeScript parity
    test for every curve preset, fork tests against Kuru's live contracts,
    and Slither with 0 findings at medium and above.
  - Server: 409 tests (380 unit tests run in CI). Plugin and Kimi agent: 20 tests. CRE workflow:
    7 tests on Chainlink's SDK test runtime. Envio: 10 handler tests.
  - A production build, end to end on a fork with real signed transactions:
    59 of 60 app checks, the 88-call API harness, passkeys, sealed drafts,
    the plugin's trade path (11 checks), the Perpl bot and a CRE report.
    The 60th check is Privy's modal, which opens only on Privy's allowed
    origins; it passed on the hosted app.
  - Biome lint and four TypeScript projects (API, app, plugin, CRE
    workflow) clean. CI runs all of the above except the fork E2E.
- **Monad integration.** See *Why Monad*; Pyth read from its contract on
  Monad; Envio HyperIndex for full history.
- **Track fit.** Every coin that fills can open its own Kuru order book,
  seeded from its raise. Perps on Perpl with AUSD margin, a risk view and a
  bot. Pre-IPO and stock trackers with an attested NAV.
- **Innovation.** The curve's shape is a product decision: four presets
  (content, thin name, IPO book, tight NAV), each measured (JUNO.md). A
  post's venue is the creator's choice. Tracker NAVs are attested on chain.
  A passkey both holds the account and seals drafts.

## Bounties

Bounties are scored 40% on meeting the stated requirements, 30% technical,
20% Monad integration and 10% innovation. Each section quotes what the bounty
asks, then says how Juno meets it and where the proof is.

### Kuru: Bring New Assets and Markets to Kuru ($5k, T1)

- **Asks:** a new class of tradable markets on Kuru's spot book, with the
  infrastructure that makes them viable: issuance, settlement, liquidity and
  onboarding.
- **Juno:** every post whose creator picks Kuru is a new asset with a path to
  its own market.
  - Issuance: the post's bonding curve.
  - Liquidity: when the curve fills, `KuruGraduator` opens a Kuru market for
    the token through v1 `Router.deployProxy` (the permissionless path). It
    deposits the curve's raise and reserved supply into the market's vault at
    the curve's final price, and burns the vault shares.
  - Settlement: on Kuru's book.
  - Onboarding: the social feed.
  - The token refuses transfers into Kuru's MarginAccount until graduation,
    so nobody can price it there first.
  - Trade → **Kuru** lists every market Juno has opened.
- **Evidence:** [`KuruGraduator.sol`](../contracts/src/graduators/KuruGraduator.sol);
  fork tests against Kuru's live contracts (`contracts/test`); E2E F1–F4 on the
  fork (graduate, trade, limit orders, history); the Kuru markets list.
- **Status:** fork. A Kuru-venue coin on hosted testnet needs MON (owner).

### Kuru: Build the Next Consumer Trading App on Kuru ($5k, T1)

- **Asks:** a focused spot trading product routing trades through Kuru's
  on-chain order book.
- **Juno:** once a coin graduates into Kuru, every trade in the app goes
  through its book. That covers market buys and sells from the feed, Reels
  and the coin page, limit orders, cancel and withdraw. Quotes come free
  through Kuru's own `eth_call` path ([`lib/juno/kuru.ts`](../lib/juno/kuru.ts)).
  The MetaMask plugin routes through the same book.
- **Target users:** people who already spend their attention on posts and
  reels and want a stake in what they like, and creators, who are paid the
  trading fees on their own posts.
- **Evidence of demand:** creator coins and bonding-curve launches are among
  the most used consumer crypto products (Zora, pump.fun). Juno's twist is
  that a post that succeeds ends on an order book with locked two-sided
  liquidity, not on a curve.
- **Retention plan:** the feed is the loop. New posts arrive every visit, and
  a live tape shows trades as Monad commits them. Price alerts, watchlists and
  recurring buy plans bring people back, and autopilot runs those plans for
  them. Creators keep posting because each post pays them.
- **Continuation plan:** after the hackathon, move to Kuru on mainnet with
  Kuru's market-creation access, and ship the native apps to the stores.
- **Status:** fork (F1–F4). Hosted testnet as above.

### Perpl: Analytics / Risk Tool (3 × $1k, T1)

- **Asks:** an analytics or risk tool on Perpl.
- **Juno:** Perps → **Risk**, live from Perpl's public API
  (`GET /api/juno/perps/risk`).
  - Per market: funding now and a year, the last day's payments and their
    cost to a $1,000 long, premium to the oracle, realised volatility and the
    24h range.
  - Per position: leverage on equity, distance to liquidation, margin against
    maintenance, funding per day, and a 10% adverse move.
- **Evidence:** E2E-HOSTED.md (5 Oct, a real position on testnet);
  `tests/e2e/walk.mjs` (Perps · Risk).
- **Status:** testnet (5 Oct) and fork.

### Perpl: Best use of the API ($5k as 2 × $2.5k, All)

- **Asks:** a production-ready bot or automation on Perpl's API.
- **Juno:** `npm run juno:perpl-bot`, a funding-carry and position-guard bot
  ([PERPL-BOT.md](PERPL-BOT.md)).
  - It reads Perpl's public API (context, funding, candles) with retries
    that honour 429.
  - It opens on the side funding pays when funding passes its entry, closes
    when it fades, and guards positions near liquidation.
  - Limits: caps per trade, on notional and positions, a daily loss limit,
    a kill switch and a mainnet refusal. State survives restarts.
- **Evidence:** [`lib/juno/perpl-bot.ts`](../lib/juno/perpl-bot.ts) (pure
  decisions, 10 tests); X1 on the fork: deposit, open a real BTC short
  through `execOrder`, close it, and the kill switch holds.
- **Status:** fork. A live testnet run needs 1 MON on the bot key (owner).

### Agora: Best Mobile Trading App ($10k, T1)

- **Asks:** a mobile app authenticating via **Mera**, holding an **AUSD**
  balance and trading through **Perpl**.
- **Juno:** passkey login (Mera) → *Get 10,000 test AUSD* (Agora's faucet,
  `requestFunds`) → open a Perpl account → a 2x position → close and
  withdraw. It is all in one app, on a phone browser today.
  - The iOS and Android apps carry the same Mera account through Mera's React
    Native client. The relying party is the web app's domain, so it is one
    account on web and phone.
- **Evidence:** E2E-HOSTED.md (5 Oct, real testnet: Mera account, AUSD
  arrived, Perpl round trip); [MOBILE-PASSKEYS.md](MOBILE-PASSKEYS.md).
- **Status:** testnet on the web. A native passkey ceremony needs the owner's
  Apple team id (Associated Domains) and Android release certificate.

### Mera: Best Mera-Powered UX on Monad ($2.5k, All)

- **Asks:** Mera as the entire account layer. Judged on time to first
  transaction, session design and the stateless test.
- **Juno:**
  - Time to first transaction: one passkey prompt makes the account. The
    first transaction (the AUSD faucet) landed in 1.6 s with 0 further
    prompts on testnet.
  - Session design: a 15-minute signing session with a countdown on the
    profile. *End session* wipes the key, and the next signature asks exactly
    once.
  - Stateless test: clear storage, then *Sign in with my passkey*, and the
    same address comes back. Only `{address, credentialId}` is ever stored.
- **Evidence:** [`juno-expo/lib/mera.ts`](../juno-expo/lib/mera.ts); E2E P1–P3
  (fork, production build) and E2E-HOSTED.md (testnet, 5 Oct).
- **Status:** testnet and fork. A live cross-device test needs a second
  device with a synced passkey.

### Mera: One Passkey, Many Keys ($2.5k, All)

- **Asks:** a creative non-wallet use of PRF key material, under at least one
  namespaced salt.
- **Juno:** **sealed drafts**. A post's words are encrypted to the creator's
  passkey under a per-draft PRF salt (a Mera secret vault, AES-256-GCM with
  HKDF). The server keeps only the ciphertext. On any device, the passkey
  opens the draft and fills the composer.
- **Evidence:** E2E P4: the server holds the vault only; after a wipe and sign
  back in, it opens; delete leaves nothing.
- **Status:** testnet (5 Oct) and fork.

### Privy: beyond authentication ($5k, All)

- **Asks:** integrate Privy beyond login, with bonus points for several
  features.
- **Juno** ([AUTOPILOT.md](AUTOPILOT.md)):
  1. **Embedded wallets** on web, iOS and Android sign every launch, trade
     and claim the server builds.
  2. **Policies:** a per-wallet policy allows only Juno trades paid out to
     that wallet, caps the MON per trade, and expires.
  3. **Session signers:** the app adds Juno's key quorum as a signer, under
     that policy.
  4. **Server wallet API:** due plans run through
     `wallets().ethereum().sendTransaction`.
  5. **Gas sponsorship** (`sponsor: true` on Monad testnet).
- **Evidence:** [`lib/juno/privy-policy.ts`](../lib/juno/privy-policy.ts)
  (9 tests, including that every rule refuses what it should);
  [`lib/juno/autopilot.ts`](../lib/juno/autopilot.ts) (6 tests);
  [`lib/juno/privy-keys.ts`](../lib/juno/privy-keys.ts) (the authorization
  signature verified).
- **Status:** owner. A live run needs the Privy signer (`npm run
  juno:privy-setup`), sponsorship on in the dashboard, and the testnet go,
  because Privy broadcasts to testnet itself. Privy sign-in and signing
  passed on the hosted app on 5 Oct.

### Chainlink: Best workflow with CRE ($3k, All)

- **Asks:** a CRE workflow used as an orchestration layer; a CLI simulation
  is accepted.
- **Juno:** `cre/juno-nav`, a NAV oracle for tracker coins.
  - A cron trigger reads Tessera's marks over HTTP with DON consensus (median
    mark).
  - EVM reads on Monad: Pyth, Chainlink's USDC/USD feed and each tracker's
    curve on `JunoLaunchpad`.
  - It computes the premium to NAV in integers and writes a signed report to
    `JunoNavOracle`, which is built on Chainlink's `ReceiverTemplate` and
    refuses replays.
  - The coin page shows "Attested on Monad by Chainlink CRE".
- **Evidence:** [`cre/juno-nav/`](../cre/juno-nav/) (7 workflow tests on the
  SDK's test runtime; compiles to WASM);
  [`JunoNavOracle.sol`](../contracts/src/cre/JunoNavOracle.sol) (9 tests).
  X3 on the fork: a report the workflow's code built from live readings went
  through Monad's MockKeystoneForwarder, `navOf` holds it, and the app shows
  it.
- **Status:** fork. `cre workflow simulate --broadcast` needs the owner's
  `cre login` and the testnet go.

### MetaMask: Best Agent Wallet Plugin ($2.5k, T1)

- **Asks:** a plugin that gives the MetaMask Agent Wallet a new trading
  superpower.
- **Juno:** `mm-plugin-juno` adds `mm juno markets | coin | buy | sell |
  portfolio | ask`.
  - Juno's server builds each trade for the selected wallet, on the coin's
    curve, its v2 pair or its Kuru book, with approvals.
  - The Agent Wallet's `walletExecutor` signs each step with a stated intent,
    so Guard mode and simulation apply.
  - Capabilities are declared per command. The manifest is validated against
    MetaMask's schema.
- **Evidence:** [`mm-plugin-juno/`](../mm-plugin-juno/README.md) (20 tests).
  It installs and runs in the real `mm` 7.0.0: `markets` and `coin` answer
  from the API. A fork E2E of the trade path passes 11 checks: a curve buy,
  a v2 buy, an exact 50% sell, a sell to zero, a refusal, and the portfolio.
- **Status:** fork. A live buy through MetaMask's executor needs the owner's
  `mm login`.

### Kimi ($3k credits across 10 teams, All)

- **Asks:** a project genuinely powered by Kimi, not a chat widget.
- **Juno:** `mm juno ask "buy 1 MON of the coin closest to graduating"`.
  - Kimi K2.6 plans the trade with tool calls over the plugin's own
    functions: markets, coin, portfolio, buy and sell.
  - Its buys and sells are real transactions through the Agent Wallet,
    bounded by a spend cap per request, a step limit and dry run.
  - `reasoning_content` is sent back each turn.
- **Evidence:** [`agent.ts`](../mm-plugin-juno/src/lib/agent.ts) and its
  tests.
- **Status:** owner. A live run needs `MOONSHOT_API_KEY`. The command refuses
  to run without it; there is no stand-in model.

### Envio: Best Use of Envio ($1k, All)

- **Asks:** a non-trivial indexer with derived entities, deployed, with a
  consumer and data flowing end to end.
- **Juno:** HyperIndex v3 over the launchpad, every Juno token, the Kuru
  graduator and its markets, and v2 pairs registered as they appear.
  - Derived entities: positions with average cost, pool stats, holder counts
    and open Kuru orders.
  - Consumer: the API, for history, holders, portfolios and the leaderboard.
  - Self-hosted on Railway beside the API since 1 Oct.
- **Evidence:** [`indexer/`](../indexer/) (`config.yaml`, `schema.graphql`,
  handlers, 10 tests).
- **Status:** testnet (hosted, 1 Oct).

## Demo script: 3 minutes

Recorded from the hosted app after the testnet go, or from `npm run
demo:local`.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:12 | The feed: reels and photo posts, each with a price and Buy | "Every post on Juno is a market on Monad." |
| 0:12–0:35 | Profile → Passkey → Create (one prompt) → Wallet → Get testnet MON → buy a post from the feed. The receipt: confirmed in under a second, MonadVision link. | "One passkey is the whole account, through Mera. The buy is confirmed in the same call." |
| 0:35–0:55 | + → Post a photo → name, preset → Launch. The live tape: Proposed → Voted → Finalized. | "Publishing is one transaction: token, curve and the lock on its future pair." |
| 0:55–1:20 | A coin graduated into Kuru: its book, a market buy, a limit order placed and cancelled; Trade → Kuru lists Juno's markets | "When a curve fills, the post opens its own Kuru order book, seeded from its raise and locked." |
| 1:20–1:45 | Trade → Perps → Get 10,000 AUSD (Agora) → open 2x BTC → Risk: liquidation distance, funding → close | "Perps on Perpl with Agora's AUSD, and a risk view on Perpl's API." |
| 1:45–2:05 | Trade → Pre-IPO → OpenAI: the Tessera mark, the band, "Attested on Monad by Chainlink CRE" | "Pre-IPO trackers, marked against Tessera, with the NAV attested on chain by a CRE workflow." |
| 2:05–2:25 | Privy sign-in → Profile → Wallet → Plans → Turn on autopilot → a plan bought, gas paid by Privy | "Autopilot: Juno's signer under a Privy policy that only allows Juno trades paid to you." |
| 2:25–2:50 | Terminal: `mm juno ask "buy 1 MON of the coin closest to graduating"`. Kimi's tool calls, then the Agent Wallet signs. | "An agent can trade Juno too: Kimi plans it, MetaMask's Agent Wallet signs it." |
| 2:50–3:00 | The repo: tests passing, `npm run demo:local` | "Open source, tested, and runnable in one command." |

## Rules checklist

- **New work:** README, *Built in the Metropolis window*. The first line was
  written on 16 Sep (Solana) and the Monad port started on 24 Sep. The
  section names external code and dates each part.
- **Commit history** covers the build. Nothing was squashed.
- **AI tools** are disclosed in the README (Claude Code).
- MIT, public repository.
- **No fake volume.** `scripts/juno-demo.ts` makes four wallets named
  `demo_ana`, `demo_kai`, `demo_rio` and `demo_lena`, and places a few small
  trades between them so the feed is not empty. They are labelled as demo
  wallets, and their trades are never presented as organic.

## For judges

1. Open <https://juno-monad-app.vercel.app> on a phone or desktop, or run
   `npm run demo:local` and open <http://localhost:8183>.
2. Profile → *Sign with* → **Passkey** → *Create a passkey account* (one
   prompt). Trades then sign without prompts for 15 minutes; *End session*
   wipes the key. Clear the browser and *Sign in with my passkey*: same
   address.
3. Fund it: Profile → **Wallet** → *Get testnet MON* (Juno's faucet).
4. Trade → **Perps** → *Get 10,000 test AUSD* (Agora's faucet) → *Open
   account* → open a 2x position → **Risk** shows its distance to
   liquidation, margin health and funding → close and withdraw.
5. Trade → **Kuru**: the markets Juno opened on Kuru's order book.
6. Feed → buy a post. The receipt links the transaction on MonadVision, and
   the live tape shows it move Proposed → Voted → Finalized.
7. + → Post a photo → launch: one transaction. A passkey account can also
   *Seal this draft*: encrypted to the passkey, opened on any device with it.
8. Signed in with Privy: Profile → Wallet → Plans → **Turn on autopilot**
   ([AUTOPILOT.md](AUTOPILOT.md)).
9. From a clone: `npm run juno:perpl-bot -- status` shows the markets the
   Perpl bot watches and what it would do; `run --dry-run --once` decides
   without signing ([PERPL-BOT.md](PERPL-BOT.md)).
