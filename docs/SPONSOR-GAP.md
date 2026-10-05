# Sponsor gap check — Juno on Monad (5 Oct 2026)

Measured against `/Volumes/Extreme SSD/Projects/METROPOLIS-SPONSORS.md` (sponsor
research of 5 Oct). Bounties are scored **40% meeting the stated
requirements**, 30% technical, 20% Monad integration, 10% innovation, so the
"Gap" column is written against each bounty's own words. Testnet facts below
were re-checked today: the Agora AUSD faucet holds ~997M AUSD and
`requestFunds` simulates cleanly; Perpl's public funding and candle endpoints
answer; Juno's Kuru path (v1 testnet `Router.deployProxy`, open to anyone)
opened and traded real markets in the local-net and testnet runs.

## Recommendation: enter Track 1 (Onchain Finance & Trading)

| | Track 1 | Track 3 (the old plan) |
|---|---|---|
| Track-locked bounties Juno can claim | Kuru New Markets $5k · Kuru Consumer App $5k · Perpl Risk Tool $3k (3 × $1k) · MetaMask plugin $2.5k · Agora Mobile Trading $10k (needs Mera) | Hunyuan — $2k **cloud credits** |
| Fit with what is already built | Juno opens a **new Kuru market for every graduated coin** and seeds it from the curve's raise — issuance, liquidity and settlement for a new class of asset, which is the New Markets bounty almost word for word. Perps on Perpl with AUSD are built and signed. Pre-IPO trackers (Tessera) are a finance product. | "Every post is a market" reads as a literal Track 3 example; track fit (20% of the main score) is stronger here. |
| Sibling entries in the track | XORR (agents trading inside a permission) | KOMA |
| Crowding | Likely the busiest track | Less crowded |

**Why Track 1.** The track decides which bounties stack, and Track 3 unlocks
only $2k of credits, while Track 1 opens ~$15k of cash that Juno fits with
little new work (Kuru ×2, Perpl risk) and $10k more if Mera lands (Agora).
Main-track odds are somewhat better in Track 3, but 20% of one score does not
outweigh the bounty access, and either track puts Juno beside a sibling entry.
Juno's main-track pitch survives the move: a creator launchpad whose coins
graduate into real order books, with perps and pre-IPO exposure beside them.

**Rules risk to settle first:** the official rules say *one project per
participant*. The portfolio has six entries; each needs a different
registered participant (or team), or the extras risk disqualification.

## Gap table

Effort: S ≤ ½ day, M 1–2 days, L 3+ days. Value is the cash at stake times a
rough chance of winning it; credits count low.

| Bounty | Lock | Juno today | Gap against the stated requirement | Effort | Value | Plan |
|---|---|---|---|---|---|---|
| **Kuru — Bring New Assets and Markets** ($5k) | T1 | Every Kuru-venue coin graduates into its **own Kuru market**, opened by `KuruGraduator` (v1 testnet `deployProxy`) and seeded from the curve (vault deposit, locked); market and limit orders, cancel, withdraw; indexer tracks fills and orders. Proven end to end (local net F1–F4; `cli-lifecycle.sh`). | The submission must say it plainly: issuance (bonding curve), liquidity (vault seeded at graduation), settlement (on the book), onboarding (social feed). No screen yet lists "the markets Juno brought to Kuru". | S | High | Markets list on the Trade tab; write-up |
| **Kuru — Next Consumer Trading App** ($5k) | T1 | Graduated Kuru coins trade through the book from the app (market buys/sells, limit orders). | Fills go through Kuru only after graduation; before that the curve trades. Needs the required fields: target users, evidence of demand, retention plan. v2 (the "active" testnet) is not used — v2 market creation is permissioned. | S | Medium | Write the three fields; say v1 is the permissionless path |
| **Perpl — Analytics / Risk Tool** ($3k as 3 × $1k) | T1 | Perps tab: markets with mark, 24h, funding, OI; positions with entry, P&L and liquidation price. | No risk view: funding history, long/short skew, distance to liquidation and margin use per position. | S–M | Medium | Risk panel from Perpl's public API |
| **Agora — Best Mobile Trading App** ($10k) | T1 | Mobile app (Expo iOS/Android) trading Perpl perps with AUSD collateral; AUSD balance shown. | **Mera passkey sign-in is required** (device key and Privy don't count). No in-app AUSD faucet. Mera on native needs a passkey domain (AASA + assetlinks) and the user's Apple/Google accounts on test devices. | L | High if Mera ships | AUSD faucet now; Mera web first, native if time allows |
| **MetaMask — Agent Wallet Plugin** ($2.5k) | T1 | None. | A `mm` plugin (oclif) — e.g. `mm juno buy/sell` or `mm perpl` — submitting through `walletExecutor`. Separate artifact. | S–M | Low–medium | Later, if time |
| **Envio — Best Use** ($1k + hosting) | All | HyperIndex v3 over five contracts (launchpad, tokens, Kuru graduator, Kuru markets, v2 pairs registered dynamically), derived entities (positions with average cost, pool stats, holder counts, open Kuru orders); drives history, holders, portfolios, leaderboard. **Self-hosted on Railway** and caught up on testnet. | Nothing required. Could add HyperSync (needs `ENVIO_API_TOKEN`) — optional. | — | Medium | Name it in the submission |
| **Privy — beyond authentication** ($5k) | All | Embedded wallet (web + native) signs every launch, trade and claim the server builds. | Login-only disqualifies; signing helps, but the bonus is for several features. Missing: native gas sponsorship (`sponsor: true`, Monad testnet supported), session signers / policies. Gas sponsorship is a Privy dashboard setting the owner must enable. Conflicts with Mera if Agora is pursued (two account layers). | S–M | Medium | Owner enables sponsorship; then wire `sponsor: true` |
| **Perpl — Best use of the API** ($5k as 2 × $2.5k) | All | Perps trading UI with on-chain `execOrder`. | Asks for a **production-ready bot or automation**. Juno has none for Perpl (its "plans" automate coin buys). Would need e.g. take-profit/stop-loss automation through a DelegatedAccount operator, or an API-key bot (key enrolment is the owner's). | M–L | Medium | After the T1 items |
| **Mera — Best UX** ($2.5k) / **One Passkey, Many Keys** ($2.5k) | All | None. | Mera as the whole account layer; one ceremony; prompt-free signing sessions with expiry UX; stateless test. Many Keys: a second PRF salt doing non-wallet work (e.g. encrypted DMs or drafts). | M / S after Mera | Medium | With the Agora work |
| **Chainlink CRE** ($3k) | All | Tracker marks come from Tessera and Pyth, read off-chain. | A CRE workflow (cron → Tessera/Pyth HTTP with consensus → `writeReport` to a receiver on monad-testnet) as the tracker NAV oracle. Needs the owner's `cre login`. | M | Medium | If the owner logs in |
| **Nansen** ($5k pool) | All | None. | Needs an API key; data is mainnet-only and Juno's coins are testnet, so only MON-level signals apply. Weak fit. | M | Low | Skip unless a key appears |
| **Alchemy** ($1k credits) | All | Public RPC. | Needs a key; "meaningful" means Gas Manager or `monadLogs`, not a URL swap. | S | Low | Owner's key |
| **Aurora Intents** ($5k) | All | None. | Mainnet only, real funds. | M | Low | Skip |
| **Dynamic** ($5k) | All | None. | A third account layer. | S–M | Low | Skip |
| **Hunyuan** ($2k credits) | T3 | None. | Only if Track 3. | S | Low | — |
| **Kimi** (credits) | All | No LLM step. | Must be load-bearing, not a chat widget. | M | Low | Skip |

## What gets built now (no owner action needed)

1. **AUSD faucet in the Perps tab** (Agora's faucet, `requestFunds`) — every
   judge can get collateral and place a real Perpl trade on testnet. Serves
   Agora and the Perpl bounties and fixes the hosted perps flow.
2. **Perpl risk panel** — funding history, long/short skew, liquidation
   distance and margin use. Perpl Risk Tool bounty.
3. **Kuru markets list** — every market Juno opened on Kuru with its book,
   liquidity and volume. Kuru New Markets bounty.
4. **Submission write-ups** — Kuru's required fields, the Track 1 pitch,
   Envio deliverables.

## What only the owner can do

- MON for the demo content and the hosted faucet (~20 MON to the deployer).
- `PINATA_JWT` and `PRIVY_APP_SECRET` on Railway (command in DEPLOY.md).
- Privy gas sponsorship (dashboard); Chainlink `cre login`; Nansen/Alchemy keys
  if those bounties are wanted.
- Mera on native: Apple team / Android signing for the passkey domain.
- Confirm the one-project-per-participant rule across the six entries.
