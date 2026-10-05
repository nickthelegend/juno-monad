# Metropolis — where Juno fits

Monad's Metropolis hackathon: online, **1 Sep – 13 Oct 2026** (deadline 13 Oct,
11:59 pm ET), $250k+ in prizes. Judging 14–27 Oct, winners 3 Nov.
<https://monad.xyz/developers/hackathons/metropolis> · apply at
<https://hackathon.monad.xyz>.

## The track: 01 — Onchain Finance & Trading (decided 5 Oct)

Juno enters **Track 01**. The full reasoning, bounty by bounty, is in
[`SPONSOR-GAP.md`](SPONSOR-GAP.md); in short, a project's track decides which
bounties stack on it, and Track 03 unlocks only Tencent's $2k of cloud
credits, while Track 01 opens Kuru's two $5k bounties, Perpl's $3k risk-tool
bounty, MetaMask's $2.5k plugin bounty and Agora's $10k mobile trading
bounty — and Juno already does most of what those ask. Track 03 remains the
better *fit* on paper ("every post is a market" is close to one of its own
examples), but fit is a fifth of one score.

The pitch for Track 01: **a creator launchpad whose coins graduate into real
on-chain order books.** Every post is a bonding curve; the ones that choose
Kuru open their own Kuru market when the curve fills, seeded from the raise
and locked; perps on Perpl and pre-IPO trackers marked against Tessera sit
beside them, all signed by one wallet.

**Prize:** $30,000, split between three teams ($10k each). Grand Champion
($25k) is picked across all tracks. **Scoring (every track):** Product
Quality, Technical Excellence, Monad Integration, Track Fit, Innovation —
20% each. Bounties: requirements 40%, technical 30%, Monad integration 20%,
innovation 10%.

## Bounties to claim, and the evidence for each

| Bounty | Prize | Lock | Juno's evidence |
|---|---|---|---|
| **Kuru — Bring New Assets and Markets to Kuru** | $5k | T1 | `KuruGraduator` opens a Kuru market per graduated coin (v1 testnet `Router.deployProxy`, the permissionless path) and deposits the curve's raise and reserved supply into the market's vault, locked — issuance (curve), liquidity (vault), settlement (the book), onboarding (the feed). Trade tab → **Kuru** lists every market Juno opened. Proven: `docs/E2E-PLAN.md` F1–F4 and J7 (a Kuru coin launched, filled, graduated and traded through the operator scripts). |
| **Kuru — Next Consumer Trading App** | $5k | T1 | Graduated Kuru coins trade through the book from the app: market buys and sells, limit orders, cancel, withdraw (`lib/juno/kuru.ts`). Required fields below. |
| **Perpl — Analytics / Risk Tool** | 3 × $1k | T1 | Perps → **Risk**: per market funding now and annualised, the last day's payments and their cost to a $1,000 long, premium to the oracle, realised volatility, 24h range; per position leverage on equity, distance to liquidation, margin against maintenance, funding per day, a 10% adverse move. Live from Perpl's public API (`GET /api/juno/perps/risk`). |
| **Agora — Best Mobile Trading App** | $10k | T1 | Built: a mobile app (Expo iOS/Android) holding AUSD (Agora's faucet in-app, 10,000 per request) and trading Perpl perps with it. **Missing: Mera passkey sign-in**, which the bounty requires. |
| **Envio — Best Use** | $1k + hosting | All | HyperIndex v3 over the launchpad, tokens, Kuru graduator and markets, and v2 pairs (registered as they appear); derived entities for positions with average cost, pool stats, holder counts, open Kuru orders. Self-hosted on Railway; drives history, holders, portfolios and the leaderboard. |
| **Privy** | $5k | All | Embedded wallet (web, iOS, Android) signs every launch, trade and claim. Gas sponsorship would add a second Privy feature — a dashboard setting for the owner. |

### Kuru's required fields (consumer-app bounty)

- **Target users.** People who already spend their attention on posts and
  reels and want a stake in what they like: they buy the post, and when
  enough of them do, it becomes a real Kuru market they can keep trading.
  Creators, who are paid trading fees on their own posts.
- **Evidence of demand.** Creator coins and bonding-curve launches are among
  the most used consumer crypto products (Zora, pump.fun); Juno's twist is
  that a successful post does not end on an AMM curve but on an order book
  with locked two-sided liquidity. On testnet: every flow is live at
  https://juno-monad-app.vercel.app, with $GENESIS taken through its whole
  life on chain.
- **Retention plan.** The feed is the loop: new posts every visit, a live
  tape of trades as Monad commits them, price alerts and weekly buy plans
  (saved, paused and resumed from the profile), and creators who keep posting
  because each post pays them.

## Rules that matter for this repo

From the official rules (v3):

- **New work.** "The substantial majority" must be built during the hackathon.
  Older code may be a foundation only if the README identifies it. → The
  README's *Provenance* section does this: Juno's Solana version was written
  from 16 Sep (inside the window) and this port from 24 Sep.
- **Commit history** covering the build window. → Commit as you build; don't
  squash at the end.
- **AI coding tools must be disclosed in the README.** → Done.
- **Open source under an OSI licence** in a public GitHub repo. → MIT.
- **One project per participant.** Check that nobody on the team has another
  Metropolis submission.
- **Wash trading or fake volume is grounds for disqualification.** Demo trades
  should be real, small and few.

## Submission checklist

- [x] Deploy the contracts to Monad testnet (`contracts/deploy.sh testnet`) and
      verify them on MonadVision.
- [x] Deploy the API and the app's web build; set `JUNO_APP_URL`.
- [x] Run a full lifecycle on testnet — launch, trade, fill, graduate, claim —
      and put the transaction links in JUNO.md's *On-chain proof*.
- [ ] Technical demo video, **≤ 3 minutes** (YouTube/Loom/Vimeo), showing the
      product running and Monad transactions.
- [ ] Founder pitch video, **≤ 2 minutes**.
- [ ] A cover graphic, ≤ 3 MB.
- [ ] Project profile: live link with instructions for judges, public repo,
      contract addresses, and a line on *why Monad* (sub-second finality makes
      buying mid-scroll feel instant; one-transaction launches; cheap enough to
      price a single post).
- [ ] Pick **Track 01** as primary; add Kuru ×2, Perpl Risk, Envio, Privy (and
      Agora if Mera ships) on the platform before the deadline.
