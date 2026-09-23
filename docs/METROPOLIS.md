# Metropolis — where Juno fits

Monad's Metropolis hackathon: online, **1 Sep – 13 Oct 2026** (deadline 13 Oct,
11:59 pm ET), $250k+ in prizes. Judging 14–27 Oct, winners 3 Nov.
<https://monad.xyz/developers/hackathons/metropolis> · apply at
<https://hackathon.monad.xyz>.

## The track: 03 — Social, Attention & Culture

> Open social graphs, programmable incentives, and fast settlement can change
> how communities create and capture value.

Juno is close to a literal reading of two of the track's own examples:

- *"A feed where curation is paid for by the people who benefit from it"* — a
  buy **is** a curation signal, and the poster is paid for it in trading fees.
- *"Markets on cultural outcomes rather than financial ones"* — every post and
  reel is its own market.

The official rules define Track 03 as projects whose "core user value is social
connection, cultural participation, or community, even where financial
mechanics are involved" — which is Juno's pitch exactly. Track 01 (*Onchain
Finance & Trading*) is the alternative; see *Why not Track 01* below.

**Prize:** $30,000, split evenly between three teams ($10k each). A Grand
Champion ($25k) is picked across all tracks.

**Scoring (every track):** Product Quality, Technical Excellence, Monad
Integration, Track Fit, Innovation — 20% each.

## Sponsor bounties that stack on Track 03

Bounties are **locked to your primary track** on the platform: only "all
tracks" bounties, and Track 03's own, can be added. Bounties are judged on
following the bounty's requirements (40%), technical work (30%), Monad
integration (20%) and innovation (10%).

| Bounty | Prize | What it asks | Juno | Status in this repo |
|---|---|---|---|---|
| **Envio** — Best Use of Envio | $1,000 (+ Envio Cloud hosting for winners) | Indexer drives a core feature; public config/schema/handlers; a frontend using the data | Trade history, charts, portfolios and the leaderboard need an indexer on Monad (public `eth_getLogs` is capped at 100 blocks) | **Built**: `indexer/` + `lib/juno/envio.ts` |
| **Privy** | $5,000 (single) | "Beyond authentication — login-only integrations will not qualify." Show what Privy powers; bonus for several features | Embedded wallet signs launches and trades; funding; gas sponsorship | Not yet: the app signs with a device key; the wallet has a `Signer` seam for it |
| **Nansen** | $5,000 pool | A product powered by Nansen data "that goes beyond exposing raw data" | "Smart money is buying this reel" on the feed and coin page | Not started |
| **Chainlink CRE** | $3,000 | A real CRE workflow connecting a chain to an external API (CLI simulation or live) | A workflow that fetches Tessera / equity marks and writes them to Monad for the NAV band | Not started |
| **Aurora Intents** | $5,000 (2.5k/1.5k/1k) | A working, not mocked, integration of Swap API / Intents Deposits / Connect; funds arriving from another chain and used in the app | Fund a Juno wallet from any chain | Not started |
| **Alchemy** | $1,000 credits | Use at least one Alchemy service in a working app | Alchemy as the dedicated `MONAD_RPC_URL` (1,000-block `getLogs`) | Config only — set `MONAD_RPC_URL` |
| **Hunyuan** (Tencent) | $2,000 credits — **Social track only** | Multimodal / interactive features | Captions, covers or moderation for reels | Not started |
| **Mera** — Best Mera-Powered UX | $2,500 | Mera (Category Labs' passkey library) is the whole account layer; one passkey prompt; survives a "stateless test" on a second device | Replaces the device key with a recoverable passkey account | Not started — conflicts with Privy; pick one |
| **Monad Foundation** — Best Community Team Project | $5,000 | Team belongs to a listed community-supporter group | Only if someone on the team is a member | — |

A realistic stack for Track 03: **Envio + Privy + Nansen + Alchemy (+ CRE or
Hunyuan)** on top of the track prize.

### Why not Track 01

Track 01 unlocks the two Kuru bounties ($5k "Build the Next Consumer Trading App
on Kuru", $5k "Bring New Assets and Markets to Kuru") — graduating curves into
Kuru order books instead of Uniswap v2 would be a direct fit, and the graduator
is an interface for exactly that reason. Two costs: the rules define Track 01's
primary user as "a trader, protocol, or financial product builder", which is a
weaker fit than Track 03's; and Kuru market creation on **mainnet** is owner-only
(simulated `Router.deployProxy` reverts `Unauthorized()`), open only on testnet.
Agora's $10k "Best Mobile Trading App" is also Track 01 and requires Mera login,
an AUSD balance **and** a trade through Perpl.

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

- [ ] Deploy the contracts to Monad testnet (`contracts/deploy.sh testnet`) and
      verify them on MonadVision.
- [ ] Deploy the API and the app's web build; set `JUNO_APP_URL`.
- [ ] Run a full lifecycle on testnet — launch, trade, fill, graduate, claim —
      and put the transaction links in JUNO.md's *On-chain proof*.
- [ ] Technical demo video, **≤ 3 minutes** (YouTube/Loom/Vimeo), showing the
      product running and Monad transactions.
- [ ] Founder pitch video, **≤ 2 minutes**.
- [ ] A cover graphic, ≤ 3 MB.
- [ ] Project profile: live link with instructions for judges, public repo,
      contract addresses, and a line on *why Monad* (sub-second finality makes
      buying mid-scroll feel instant; one-transaction launches; cheap enough to
      price a single post).
- [ ] Pick Track 03 as primary; add Envio (and whichever other bounties are
      built) on the platform before the deadline.
