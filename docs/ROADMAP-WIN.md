# Roadmap to win: a judge's-eye review (7 Oct 2026)

How this was done: a fresh browser at 390 px and 1440 px against a production
build on a local fork of Monad testnet (`npm run demo:local`), used the way a
judge with five minutes and no context would. The path was: landing, Get
Started, the feed, a Buy with no wallet, a wallet, the faucet, a real buy and
its receipt, Reels, Trade, Create, a coin page. Main-track scoring is 20% each
for product quality, technical excellence, Monad integration, track fit and
innovation. Bounties are 40% "meets the stated requirement". The "before"
screenshots are in [`docs/screens/wave/`](screens/wave/).

## The 10 biggest weaknesses, by what they cost with judges

| # | Weakness | What a judge sees | Costs |
|---|---|---|---|
| 1 | **The first trade fails.** The buy sheet's quick amounts are dollars ($2, $20, $50). Juno's faucet gives 0.5 MON, which is about one cent at the fork's MON price, so the first tap reads "Not enough MON". The sheet then sends you to "your profile", a page away, where the faucet now sits behind a Wallet tab. | A dead end in the first minute, in the one flow every judge tries. (`first-trade-before-*.png`) | Product quality, Monad integration (no first transaction) |
| 2 | **Monad's speed is a sentence, not a moment.** The receipt says "confirmed … in 0.3s" in small grey text. It shows no fee, no comparison, and nothing a video can linger on. | Monad's whole advantage, easy to miss. (`receipt-before-*.png`) | Monad integration, the "wow" moment for the video |
| 3 | **The first 60 seconds are static.** The landing is an illustration and a paragraph. Nothing on it is live: no count of markets or trades, no block height, no proof anything is on chain. | "Is this real?" before Get Started. (`landing-before-*.png`) | Product quality, first impression |
| 4 | **Nobody is told anything happened.** No notifications. A creator whose post was bought, followed or commented on finds out only by opening each coin. | A social app with no social loop. (`inbox-before-*.png`, the feed header has no bell) | Product quality, track fit (creator economy) |
| 5 | **Creators can't see what they earn.** "Creators earn the trading fees" is the pitch. Yet the only fee figure is "Creator rewards" on each coin page, one coin at a time. There is no view of earnings, volume or holders across a creator's posts. | The core promise, unproven in the UI. (`analytics-before-*.png`) | Innovation, track fit |
| 6 | **First images are slow.** A first visit fetches every IPFS picture through the gateway (about 6 s each), so the feed opens on blank cards and black story rings. | A broken-looking feed for the first seconds. | Product quality |
| 7 | **The feed's main figure has no label.** The number beside Buy is the market cap, but it reads like a price, while the coin page leads with the price ($0.6442 against $0.0₉650 for the same coin). | Two prices for one thing. | Product quality |
| 8 | **Bounty evidence is mostly in docs.** Kuru, Perpl, CRE and Mera are all in the product, but nothing in the UI says "this ran on Kuru" or "attested by CRE" except in a few places. | Sponsors must hunt. | Bounty scores (40% requirement) |
| 9 | **Desktop is a phone column.** At 1440 px the app is a 480 px column on empty sage. | Wasted space on a judge's laptop. | Product quality |
| 10 | **The empty profile is empty.** With no wallet, Profile is a Sign-with switch and a lot of blank page. | A weak second screen. | Product quality |

## The 5 to build in this wave

Ranked by impact × effort. Each needs no MON and no user key, and each is
one commit with tests and before/after screenshots at desktop and 390 px.

### 1. The Monad speed receipt (weakness 2)

Done means:
- the receipt leads with **one measured figure**: the milliseconds from broadcast to a receipt, as the server timed it (`confirmedInMs`);
- under it, a **timeline**: signed on the device (ms), sent and confirmed (ms), final, with the block number;
- **what it cost**: the gas Monad charged (Monad bills the gas limit) × the effective gas price, in MON and in dollars, from the transaction's own receipt;
- **the same gas on Ethereum, now**: Ethereum mainnet's current gas price, read live from an Ethereum RPC, × the gas used × ETH/USD, with Ethereum's ~12 s block time beside it. If either read fails, the line is not shown (no made-up number);
- unit tests for the fee and comparison maths, and an e2e that reads the figures off a real receipt and checks them against the API.

### 2. The first trade in one sheet (weaknesses 1 and 7)

Done means:
- the quick amounts never exceed what the wallet can spend: dollar chips when the balance covers them, otherwise 25% / 50% / Max of spendable MON (gas kept back);
- when the wallet is short, the sheet offers **Get testnet MON** right there (Juno's faucet), and the balance updates in place;
- the feed card labels its figure ("mcap") and shows the day change;
- an e2e from a fresh browser: feed → Buy → Create wallet → Get testnet MON → a quick amount → Buy → Done, without leaving the sheet.

### 3. A live first minute (weaknesses 3 and 6)

Done means:
- the landing shows **live figures** from a new `/api/juno/stats`: coins live, trades in the last 24 h, the last trade's confirmation time in ms, and Monad's block height, ticking;
- the server **warms the image cache** for every listed coin's picture and poster after it starts and as coins launch, so a first visit's feed has its pictures;
- unit tests for the stats; an e2e checks each figure on the landing against the API.

### 4. Notifications (weakness 4)

Done means:
- a bell on the feed header with an unread count, opening an **inbox** built only from real events:
  - buys and sells of your coins, with who and how much;
  - new followers;
  - comments on your coins;
  - your price alerts crossing;
  - your coins graduating;
- read state is kept per wallet on the server, and opening the inbox clears the count;
- unit tests for building the inbox; an e2e where one wallet buys, follows and comments, and the creator's inbox shows each one, then clears.

### 5. Creator analytics (weakness 5)

Done means:
- on your own profile, an **Earnings** panel: fees claimable now across all your coins (from each pool's fee balance), fees already claimed (from the launchpad's claim events), lifetime volume, holders and trades;
- a per-post breakdown, ranked, as a bar chart;
- **Claim all** where something is claimable (real transactions, on the fork);
- unit tests for the totals; an e2e checks the panel against the API and the chain.

## What shipped in this wave

All five are built, tested and pushed. Each has before/after screenshots at
390 and 1440 px in [`docs/screens/wave/`](screens/wave/).

| Feature | Commit | Proof |
|---|---|---|
| The Monad speed receipt, with two timers | e935a50, 707c708 | `juno-tx-cost.test.ts` (7); `wave.mjs after receipt`: the ms shown equals the server's measurement, the fee matches the receipt, and the final timer is labelled |
| The first trade in one sheet | 07a198b | `juno-expo-quick-sizes.test.ts` (5); `wave.mjs after first-trade`: a newcomer goes from no wallet to Done in one sheet |
| A live first minute | 189021c | `juno-live-minute.test.ts` (6); `wave.mjs after landing`: figures equal the API, the block ticks, and pictures are warmed |
| Notifications | c198acc | `juno-inbox.test.ts` (4); `wave.mjs after inbox`: another wallet follows, buys and comments, and the creator's bell and inbox show it |
| Creator analytics | 098e52b | `juno-expo-earnings.test.ts` (4); `wave.mjs after analytics`: the total equals the chain reads |

## Monad-native coverage (items 1–8)

The full write-up, with evidence, is [MONAD-NATIVE.md](MONAD-NATIVE.md).

| # | Item | Coverage |
|---|---|---|
| 1 | Live commit-state strip (`monadNewHeads`) | **Live testnet read.** Built: chips per block with measured medians (voted ~295 ms, final ~570 ms, verified 1.5 s, 300 ms blocks) |
| 2 | Two-timer receipts | **Built.** Executed is this trade (labelled as a fork timing). Final is this trade's own on Monad; on a fork, Monad testnet's live median, labelled |
| 3 | `txpool_statusByHash` / `ByAddress` | **Built.** Works on a testnet deployment; on the fork it answers `supported: false` (anvil lacks the methods) |
| 4 | Passkeys on chain (P256 `0x0100`) | **Built, local fork.** The precompile checks a Mera passkey's WebAuthn signature (also checked live on testnet); web only, native capture not built |
| 5 | Native staking (`0x1000`) | **Live testnet read.** Epoch, proposer, set size, delegations. Delegating: awaiting testnet go |
| 6 | Monad gas correctness | **Built + documented.** Explicit limits, limit billing shown, the 10 MON reserve rule in the sheet, 19.9 KB contract, the one shared storage slot named for the next release |
| 7 | x402 / MPP payments | **Not applicable today.** Juno sells no pay-per-request API; settlement would be a testnet transaction (awaiting testnet go) |
| 8 | Canonical contracts, verification, links | **Built.** Canonical WMON, Circle USDC and Multicall3 (pinned by a test), Sourcify-verified contracts, MonadVision links |

## The next 5, after this wave

1. Sponsor badges in the UI: "Filled on Kuru", "Attested by Chainlink CRE", "Signed with a passkey (Mera)", "Margin in Agora AUSD" (weakness 8).
2. A desktop layout with side rails: the live tape and trending coins beside the feed (weakness 9).
3. A no-wallet profile that previews what you get, with a one-tap passkey account (weakness 10).
4. A shareable receipt card: an image of the speed receipt, for posting.
5. First-run coach marks on the feed (tap a post to trade it; hold to peek).
6. Record Kuru fills from the receipts Juno submits, as curve and pair fills already are. Then a Kuru coin's activity, and the landing's trade count, include them without an indexer.
