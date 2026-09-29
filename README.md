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

Built for Monad's **Metropolis** hackathon — Track 03, *Social, Attention &
Culture*: a feed where curation is paid for by the people who benefit from it.

| | |
|---|---|
| **Network** | Monad **testnet** (chain 10143). No real money. |
| **Contracts** | [`contracts/`](contracts/) — `JunoLaunchpad`, `JunoToken`, `UniswapV2Graduator`, `KuruGraduator`, `JunoSwapRouter`. Addresses are filled in by [`contracts/deploy.sh`](contracts/deploy.sh); see [DEPLOY.md](DEPLOY.md). |
| **App** | [`juno-expo/`](juno-expo/) — Expo (iOS, Android, web). |
| **Download** | [Release v1.1.0](https://github.com/nickthelegend/juno-monad/releases/tag/v1.1.0): the Android APK (arm64) and an iOS Simulator build. Both talk to a Juno API on your own machine until one is hosted — see *Install it*. |
| **API** | [`app/api/juno/`](app/api/juno/) — the Next.js server the app talks to. [docs/API.md](docs/API.md). |
| **Indexer** | [`indexer/`](indexer/) — Envio HyperIndex over the launchpad's events. |
| **Deep dive** | [JUNO.md](JUNO.md) — the curve, the contracts, what is and is not built. |

## Install it

The 1.1.0 builds point at an API on the machine running them, because none is
hosted yet: set up the stack as *Run it* below says, and start the API on
port 3100 with `npm run dev -- --port 3100`.

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
  follows it there. Testnet only: Kuru's mainnet Router lets only Kuru create
  markets.
- **Perps beside the posts.** The Trade tab carries Perpl's perpetual markets —
  BTC, ETH, SOL, MON and more, isolated margin in AUSD — with live marks,
  funding and open interest, and opens and closes positions through the same
  wallet and server-built transactions as everything else
  ([`lib/juno/perpl.ts`](lib/juno/perpl.ts)). Kuru has no perps; Perpl is
  Monad's perps exchange. Testnet AUSD is not publicly mintable, so the order
  path is proven by simulation against live testnet
  ([`scripts/perps-simulate.ts`](scripts/perps-simulate.ts)).
- **Fees that decay, paid to the poster.** A launch fee that blunts snipers
  decays exponentially to a resting fee over sixty periods. The creator takes
  the trading fees, claimable any time.
- **One transaction per action.** Launch — token, curve, the lock on its AMM pair and the
  creator's optional first buy — is one call. Selling needs no approval.
- **Keys never leave the device — or sign in with Privy.** The server builds
  unsigned transactions; the wallet signs; the server submits and records
  what the receipt says. The wallet is a device key by default, or a Privy
  embedded wallet: on the web behind email, Google or X sign-in with Privy's
  own confirmation on every trade and launch, on iOS and Android behind an
  email code in Juno's own sheet. An X account linked in Privy can be
  shown on the creator's profile once the server has verified it with Privy
  ([`lib/juno/privy.ts`](lib/juno/privy.ts)).
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
| `scripts/juno-*.ts` | Launch, trade, claim, graduate from the command line. |
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
