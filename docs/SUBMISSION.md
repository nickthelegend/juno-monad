# Metropolis submission — Track 03, Social, Attention & Culture

Deadline: **13 Oct 2026, 11:59 pm ET** (<https://hackathon.monad.xyz>).
Fields in [brackets] are filled once the thing exists; nothing here is
claimed before it is true. Where the track and bounties come from:
[METROPOLIS.md](METROPOLIS.md).

| Field | Value |
|---|---|
| Project | Juno — every post is a market |
| One-liner | Post a photo or a reel and it launches its own bonding curve on Monad; fans buy the posts they believe in and the creator earns every trade's fee. |
| Primary track | 03 — Social, Attention & Culture |
| Bounties to add | Envio (built: `indexer/`). Privy (built on web, iOS and Android; a real login still to be shown). Alchemy only if `MONAD_RPC_URL` is an Alchemy endpoint |
| Repo | [github.com/nickthelegend/juno-monad — after `scripts/publish-github.sh`] |
| Live app | [after hosting, Phase 8] |
| Contracts (Monad testnet) | [after `contracts/deploy.sh testnet`; addresses land in `contracts/deployments/10143.json` and JUNO.md's *On-chain proof*] |
| Builds | [release v1.1.0: Android APK, iOS Simulator zip, checksums] |
| Technical demo (≤ 3 min) | [video link] |
| Founder pitch (≤ 2 min) | [video link] |
| Cover graphic (≤ 3 MB) | [file] |

## Why Monad

- **A buy that lands mid-scroll.** The server submits with
  `eth_sendRawTransactionSync` and the receipt comes back in the same call:
  the trade receipt reports the confirmation time it measured ("confirmed on
  a local fork of Monad testnet in 0.7s" in the iOS build's test run).
- **One transaction per launch.** Token, curve, the lock on its future pair
  and the creator's first buy are one call — cheap enough to price a single
  post.
- **Monad's gas model, handled.** Monad charges the gas limit, not the gas
  used, so every limit is an estimate plus a measured margin, not a blanket
  multiplier (`lib/juno/tx.ts`).
- **Native venues.** A filled curve graduates into a Uniswap v2 pair or, if
  the creator chose it, its own Kuru order-book market, and the app keeps
  trading it there.

## Judging criteria (20% each)

- **Product quality.** A phone-first feed of reels and photo posts where every
  post has a price, a chart and a buy button; iOS, Android and web from one
  Expo codebase; a trade receipt with the transaction and its measured
  confirmation time.
- **Technical excellence.** Juno's own contracts (`JunoLaunchpad`,
  `CurveMath`, `JunoToken`, the Uniswap v2 and Kuru graduators, `JunoSwapRouter`):
  74 Foundry tests with fuzzed invariants, a Solidity ↔ TypeScript parity test
  for every curve preset, 7 fork tests against Kuru's live testnet contracts,
  Slither clean at medium and above in CI. 312 unit tests for the server;
  Envio handler tests.
- **Monad integration.** See *Why Monad*; Pyth read from its contract on
  Monad; Envio HyperIndex for full history because public `eth_getLogs` covers
  100 blocks.
- **Track fit.** A buy is a curation signal the curator pays for, and the
  poster is paid for it — the track's own example of "a feed where curation is
  paid for by the people who benefit from it".
- **Innovation.** The curve's shape is a product decision: four presets
  (content, thin name, IPO book, tight NAV), each measured
  ([JUNO.md](../JUNO.md), *The presets, measured*); Pre-IPO trackers marked
  against Tessera with a band the trade sheet enforces.

## Rules checklist

- New work: the README's *Provenance* section dates the Solana version (from
  16 Sep) and this port (from 24 Sep), both inside the window.
- Commit history covers the build; nothing squashed.
- AI assistance disclosed in the README.
- MIT, public repository — [once published].
- **No fake volume.** `npm run juno:demo` makes four wallets named `demo_ana`,
  `demo_kai`, `demo_rio` and `demo_lena` and places a few small trades between
  them so the feed is not empty. On testnet it is optional; if it is run, say
  so in the profile. Never present those trades as organic.

## For judges

1. Open [the live app] — or run the stack locally (README, *Run it*).
2. Profile → *Get testnet MON* (Juno's faucet), then buy a post from the feed.
   The receipt links the transaction on MonadVision.
3. Create → pick a photo → launch. One transaction; the launch log shows each
   step.
4. [A coin that graduated on testnet] shows trading continuing on its Uniswap
   v2 pair (or Kuru market).
