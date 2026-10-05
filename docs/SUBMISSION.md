# Metropolis submission — Track 01, Onchain Finance & Trading

Deadline: **13 Oct 2026, 11:59 pm ET** (<https://hackathon.monad.xyz>).
Fields in [brackets] are filled once the thing exists; nothing here is
claimed before it is true. Where the track and bounties come from:
[METROPOLIS.md](METROPOLIS.md) and [SPONSOR-GAP.md](SPONSOR-GAP.md).

| Field | Value |
|---|---|
| Project | Juno — every post is a market |
| One-liner | Post a photo or a reel and it launches its own bonding curve on Monad; when the curve fills it graduates into its own Kuru order-book market (or a Uniswap v2 pair), with perps on Perpl and pre-IPO trackers beside it. |
| Primary track | 01 — Onchain Finance & Trading |
| Bounties to add | Kuru — New Assets and Markets · Kuru — Consumer Trading App · Perpl — Analytics/Risk Tool · Perpl — Best use of the API (funding-carry and guard bot, [PERPL-BOT.md](PERPL-BOT.md)) · Agora — Mobile Trading App (Mera sign-in + AUSD + Perpl, working in the web app; native Mera wired through Mera's React Native client, finishing needs the Apple team and Android signing certificate, [MOBILE-PASSKEYS.md](MOBILE-PASSKEYS.md)) · Mera — Best UX · Mera — One Passkey, Many Keys · Kimi (`mm juno ask`: Kimi plans trades with tool calls that execute on Monad) · MetaMask Agent Wallet plugin (`mm juno buy/sell/ask`, [mm-plugin-juno](../mm-plugin-juno/README.md)) · Chainlink CRE (juno-nav: tracker NAV attested on Monad, [cre/README.md](../cre/README.md)) · Envio · Privy (autopilot: session signers under per-wallet policies, gas sponsorship, [AUTOPILOT.md](AUTOPILOT.md)) |
| Repo | <https://github.com/nickthelegend/juno-monad> (MIT) |
| Live app | <https://juno-monad-app.vercel.app> (API <https://juno-api-production-04ea.up.railway.app>) |
| Contracts (Monad testnet) | `JunoLaunchpad` `0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81`, `UniswapV2Graduator` `0x6924937d7DDDD7D1c931Dc7a9779bD32F807FeAA`, `KuruGraduator` `0xBeFD5740896D157A3E9821939e5ba213BEf50F99`, `JunoSwapRouter` `0x648c6E84F779Cf20730Db26d49B7B950ca256366`, v2 factory `0xA81f5D4884d56B7F648bCAb6e6fcdc8b8f54fb81` — all verified on MonadVision ([`contracts/deployments/10143.json`](../contracts/deployments/10143.json)) |
| On-chain proof | `$GENESIS` [`0x1409…6360`](https://testnet.monadvision.com/token/0x14092A529e2e5EB4DECB4a1828f6aFa72e026360): launched, bought, sold, filled, [graduated](https://testnet.monadvision.com/tx/0x799309cc168b1b1ea248d04fb9b9c6b90972fc7090bf42765a1cf52dc0907ed4) and traded on its pair ([E2E-PLAN.md](E2E-PLAN.md), Phase 6) |
| Builds | Web (live). Native iOS/Android build from `juno-expo/` (see README); no published release |
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
- **Track fit.** A launchpad whose markets don't end on a curve: each coin
  that fills opens its own Kuru order book seeded from its raise; perps on
  Perpl with AUSD collateral (Agora's faucet in the app), a live risk
  view, and a Perpl bot that earns funding carry and guards positions
  ([PERPL-BOT.md](PERPL-BOT.md)); pre-IPO and stock trackers priced against Tessera and Pyth.
- **Innovation.** The curve's shape is a product decision: four presets
  (content, thin name, IPO book, tight NAV), each measured
  ([JUNO.md](../JUNO.md), *The presets, measured*); Pre-IPO trackers marked
  against Tessera with a band the trade sheet enforces.

## Rules checklist

- New work: the README's *Provenance* section dates the Solana version (from
  16 Sep) and this port (from 24 Sep), both inside the window.
- Commit history covers the build; nothing squashed.
- AI assistance disclosed in the README.
- MIT, public repository: <https://github.com/nickthelegend/juno-monad>.
- **No fake volume.** `npm run juno:demo` makes four wallets named `demo_ana`,
  `demo_kai`, `demo_rio` and `demo_lena` and places a few small trades between
  them so the feed is not empty. On testnet it is optional; if it is run, say
  so in the profile. Never present those trades as organic.

## For judges

1. Open <https://juno-monad-app.vercel.app> on a phone or desktop.
2. Profile → *Sign with* → **Passkey** → *Create a passkey account* (one
   prompt). Trades then sign without prompts for 15 minutes; *End session*
   wipes the key. Clear the browser and *Sign in with my passkey* — same
   address.
3. Fund it: Profile → *Get testnet MON* (Juno's faucet).
4. Trade → **Perps** → *Get 10,000 test AUSD* (Agora's faucet) → *Open
   account* → open a 2x position → **Risk** shows its distance to
   liquidation, margin health and funding → close and withdraw.
5. Trade → **Kuru**: the markets Juno opened on Kuru's order book.
6. Feed → buy a post; the receipt links the transaction on MonadVision and
   the live tape shows it move Proposed → Voted → Finalized.
7. + → Post a photo → launch: one transaction. A passkey account can also
   *Seal this draft* — encrypted to the passkey, opened on any device with it.
8. Signed in with Privy: Profile → Plans → **Turn on autopilot**. Juno's
   signer goes on the wallet under a policy that allows only Juno trades paid
   out to it. Plans then buy themselves when due, and Privy pays the gas
   ([AUTOPILOT.md](AUTOPILOT.md)).
9. The Perpl bot, from a clone: `npm run juno:perpl-bot -- status` shows the
   markets it watches and what it would do; `run --dry-run --once` decides
   without signing ([PERPL-BOT.md](PERPL-BOT.md)).
