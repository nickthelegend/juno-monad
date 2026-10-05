# Juno — every post is a market

**Post a photo or a reel and it launches its own token on a bonding curve on
Monad.** People buy into the post itself as they scroll, the creator earns the
trading fees instead of ad revenue, and when the curve fills it graduates —
into a Uniswap v2 pair, or, if the creator chose it, into **its own Kuru
order-book market** — with the liquidity locked for good: a market that
outlives the app.

The same machinery issues **pre-IPO and stock trackers**: curves shaped like
issuances and marked against a real reference — **Tessera** marks for OpenAI,
Kalshi and SpaceX, **Pyth** feeds for AAPL, NVDA, TSLA and friends.

Built for Monad's **Metropolis** hackathon — Track 01, *Onchain Finance &
Trading*: a creator launchpad whose coins graduate into real on-chain order
books, with perps on Perpl and pre-IPO trackers beside them.

**Try it:** <https://juno-monad-app.vercel.app> — Monad testnet, nothing to
install. Profile → *Sign with* → **Passkey** makes an account from one
passkey prompt.

| | |
|---|---|
| **Network** | Monad **testnet** (chain 10143). No real money. |
| **Contracts** | [`contracts/`](contracts/) — `JunoLaunchpad` [`0xa8b0…5c81`](https://testnet.monadvision.com/address/0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81), `JunoToken`, `UniswapV2Graduator`, `KuruGraduator`, `JunoSwapRouter`, all verified on MonadVision; every address in [`contracts/deployments/10143.json`](contracts/deployments/10143.json). |
| **App** | <https://juno-monad-app.vercel.app> · [`juno-expo/`](juno-expo/) — Expo (iOS, Android, web). |
| **API** | <https://juno-api-production-04ea.up.railway.app> · [`app/api/juno/`](app/api/juno/) — the Next.js server the app talks to. [docs/API.md](docs/API.md). |
| **Indexer** | [`indexer/`](indexer/) — Envio HyperIndex over the launchpad's events. |
| **Deep dive** | [JUNO.md](JUNO.md) — the curve, the contracts, what is and is not built. |

## Install it

The web app is live at <https://juno-monad-app.vercel.app> against the hosted
API — nothing to install. To run a phone build against your own stack, set it
up as *Run it* below says and start the API on port 3100 with
`npm run dev -- --port 3100`.

- **Android emulator:** `adb install juno-monad-1.1.0-arm64.apk`. The APK
  reaches the host at `http://10.0.2.2:3100`; plain HTTP is allowed to that
  address and loopback only.
- **iOS Simulator (Mac with Xcode):** unzip `juno-monad-1.1.0-ios-simulator.zip`,
  then `xcrun simctl install booted Juno.app && xcrun simctl launch booted app.launch.junomonad`.
- **Web:** `cd juno-expo && EXPO_PUBLIC_API_URL=http://localhost:3100 npx expo start --web`.

Profile → *Get testnet MON* funds a new wallet from Juno's faucet.

## Sixty seconds in the app

1. **Feed** — posts, each one a market: worth, likes, replies, share, **Buy**.
   "Bought by" is read from real trades.
2. **Reels** — full-screen video; tap for sound, double-tap to like, and a dock
   under the caption with the reel's market cap, curve progress, **Sell** and **Buy**.
3. **Trade → Pre-IPO** — OpenAI, Kalshi, SpaceX from Tessera's marks, with the
   Juno curve tracking each and how far its implied price sits from the mark.
4. **+ → Post a photo** — pick a photo, name it, pick a curve shape; **one
   signature** later it is a live market with your post on it.
5. **Profile** — fund the wallet from the testnet faucet, choose a name, see
   holdings, cost basis and P&L; claim the fees your posts have earned.

Every number is read from the chain, Postgres, Mongo, Pyth or Tessera. When a
read fails the app says so — it does not print a zero it never measured.

## What makes it more than a launchpad

- **Sixteen-range curves with a shape.** A curve is a start price and sixteen
  ranges, each holding its own liquidity — concentrated-liquidity maths, in
  [`CurveMath.sol`](contracts/src/libraries/CurveMath.sol). The weights are the
  character of a launch: `content` (back-loaded), `thin-name` (front-loaded, for
  a low-float stock), `ipo-book` (deep at both ends), `tight-nav` (uniform,
  tracks a reference). The TypeScript builder and the contract share one
  arithmetic, and a parity test holds them to it.
- **Graduation is continuous.** The base reserved for the AMM is the curve's
  quote priced at the curve's top, so the pair opens at exactly the price the
  curve finished on. The pair's address is fixed at launch and the token
  refuses transfers into it until then, so nobody can seed it at a price of
  their choosing first — and the pair itself is only deployed when a curve
  graduates, so a launch costs about 2M gas instead of 4.6M.
- **Choose where it graduates: Uniswap v2 or Kuru.** A creator picks the venue
  at launch. With Kuru, the filled curve opens a new spot market for the token
  on Kuru's CLOB, seeds the market's AMM vault with the curve's reserves at the
  curve's final price, and burns the vault shares — every post that fills
  becomes a new asset with an order book
  ([`KuruGraduator.sol`](contracts/src/graduators/KuruGraduator.sol)). The token
  refuses transfers into Kuru's MarginAccount until then, which closes every
  way into Kuru — orders, vault deposits, router swaps — so nobody can price it
  there first. After graduation the app keeps trading the coin on its Kuru
  market (quoted free through Kuru's own `eth_call` path), and the indexer
  follows it there. Trade → **Kuru** lists every market Juno has opened.
  Testnet only: Kuru's mainnet Router lets only Kuru create markets.
- **Perps beside the posts.** The Trade tab carries Perpl's perpetual markets —
  BTC, ETH, SOL, MON and more, isolated margin in AUSD — with live marks,
  funding and open interest, and opens and closes positions through the same
  wallet and server-built transactions as everything else
  ([`lib/juno/perpl.ts`](lib/juno/perpl.ts)). Kuru has no perps; Perpl is
  Monad's perps exchange. Collateral comes from **Agora's AUSD faucet** in the
  app (10,000 test AUSD a request), and a **Risk** view reads Perpl's public
  API for each market's funding (now, annualised, the last day's payments),
  premium to the oracle and realised volatility, and for each position its
  leverage on equity, distance to liquidation and margin health.
- **Fees that decay, paid to the poster.** A launch fee that blunts snipers
  decays exponentially to a resting fee over sixty periods. The creator takes
  the trading fees, claimable any time.
- **One transaction per action.** Launch — token, curve, the lock on its AMM pair and the
  creator's optional first buy — is one call. Selling needs no approval.
- **A passkey is the whole account (Mera).** One passkey prompt makes a
  wallet: Mera's WebAuthn PRF output becomes a standard BIP-39/BIP-44 key, so
  the same passkey brings back the same address on any device or after the
  browser is cleared, and nothing secret is stored. An unlock opens a
  15-minute **signing session** — trades sign with no prompt, a countdown on
  the profile, *End session* wipes the key — and the passkey does a second
  job: **sealed drafts**, a post's words encrypted to it under their own PRF
  salt and kept on the server as ciphertext ([`juno-expo/lib/mera.ts`](juno-expo/lib/mera.ts)).
- **Keys never leave the device — or sign in with Privy.** The server builds
  unsigned transactions; the wallet signs; the server submits and records
  what the receipt says. The wallet is a device key by default, or a Privy
  embedded wallet: on the web behind email, Google or X sign-in with Privy's
  own confirmation on every trade and launch, on iOS and Android behind an
  email code in Juno's own sheet. An X account linked in Privy can be
  shown on the creator's profile once the server has verified it with Privy
  ([`lib/juno/privy.ts`](lib/juno/privy.ts)).
- **Autopilot: plans that buy themselves, gas paid by Privy.** A Privy
  wallet can add Juno's key as a session signer, under a Privy policy
  written for that wallet. The policy allows only Juno trades paid out to
  it, caps the MON per trade, and expires. Recurring buys then run on
  schedule, sent through Privy's wallet API with native gas sponsorship
  ([`docs/AUTOPILOT.md`](docs/AUTOPILOT.md)).
- **Tracker NAVs attested on chain by Chainlink CRE.** The `juno-nav`
  workflow does three things on each run. It reads Tessera marks with DON
  consensus, plus Pyth and Chainlink's USDC/USD feed on Monad. It compares
  them with each tracker's curve. It writes the premium to `JunoNavOracle`,
  and the coin page shows the attestation ([`cre/README.md`](cre/README.md)).
- **Trade Juno from an agent.** `mm juno buy/sell` brings Juno's curves,
  pairs and Kuru books to the MetaMask Agent Wallet. `mm juno ask "…"` lets
  Kimi plan the trade with tool calls, inside a spend cap
  ([`mm-plugin-juno/`](mm-plugin-juno/README.md)).
- **A Perpl bot.** Funding carry and a position guard on Perpl's API, with
  caps, a daily loss limit and a kill switch ([`docs/PERPL-BOT.md`](docs/PERPL-BOT.md)).
- **History without hammering the RPC.** Monad's public RPC answers
  `eth_getLogs` over 100 blocks — thirty seconds of chain. Trades are recorded
  from receipts as they land, a single log cursor tails the launchpad for the
  rest, and the Envio indexer serves full history.

## Layout

| Path | What |
|---|---|
| `contracts/` | Foundry project: the launchpad, the token, the graduator, tests, deploy script. |
| `juno-expo/` | **The app** — Expo (iOS, Android, web). |
| `app/api/juno/` | The API the app calls. |
| `lib/juno/` | Curves, the launchpad client, trade history, Pyth, Tessera, portfolio. |
| `indexer/` | Envio HyperIndex: trades, pools, positions. |
| `cre/` | Chainlink CRE workflow `juno-nav` (tracker NAV oracle). |
| `mm-plugin-juno/` | MetaMask Agent Wallet plugin: `mm juno …`, with Kimi. |
| `scripts/juno-*.ts` | Launch, trade, claim, graduate from the command line; `scripts/perpl-bot.ts`, the Perpl bot. |
| `docs/` | API reference and hackathon notes. |

## Run it

```bash
git clone --recurse-submodules <this repo> && cd juno-monad
npm install
cp .env.local.example .env.local      # DATABASE_URL, MONGODB_URI, PINATA_JWT, the launchpad address
npm run db:migrate
npm run dev                            # API on http://localhost:3000

cd juno-expo && npm install
npx expo start                         # i = iOS simulator, a = Android, w = web
```

Contracts: `cd contracts && forge test`. Unit tests: `npm run test:unit`.
Deploying the contracts and the app: [DEPLOY.md](DEPLOY.md).

## Provenance, and how this was built

Juno began on **16 September 2026** as a Solana app — Meteora's Dynamic Bonding
Curve for the curves, DAMM v2 for graduation — and that version's history is in
[nickthelegend/zorr-solana](https://github.com/nickthelegend/zorr-solana). This
repository is its port to Monad, started on **24 September 2026**, inside the
Metropolis build window. What carried over and what is new:

| Carried over from the Solana version | New for Monad |
|---|---|
| The Expo app's screens and design | `JunoLaunchpad`, `JunoToken`, `CurveMath`, `UniswapV2Graduator` — the curve, fees, graduation and their Foundry tests are Juno's own contracts now, not a third-party program |
| The four curve presets and their weights | The TypeScript curve builder, rewritten against Juno's own arithmetic, with a Solidity parity test |
| The social layer (follows, likes, comments, names, plans) | Wallet, signing and submission on EVM; EIP-191 name claims |
| The API's shape and its "never print an unmeasured zero" rules | Trade history from `Trade` events: receipt recording, a launchpad log cursor, the Envio indexer |
| | Pyth read from its contract on Monad; the testnet faucet in MON |

**AI disclosure.** This port was written with AI coding assistance (Claude
Code). Every contract is covered by Foundry tests, including fuzzed invariants,
and the numbers the app shows are read from the chain, not generated.

## License

MIT — see [LICENSE](LICENSE).
