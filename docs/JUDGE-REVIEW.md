# Judge review: Juno, scored as an unbiased Metropolis judge (13 Oct 2026)

Walked on the live app (<https://juno-monad-app.vercel.app>, Monad testnet) at
1440 and 390 px, following SUBMISSION's 3-minute script.

## Main track (20% each)

| Criterion | Score /10 | Why |
|---|---|---|
| Product quality | 7.5 | The feed, receipt and coin pages read at a glance. The desktop rails fill a laptop screen. A brand-new visitor goes from no wallet to a trade in one sheet. Content is the seeded demo set, not a real community. |
| Technical excellence | 8 | Own contracts, all verified (launchpad, graduators, router, NAV oracle). Server-built transactions with tight gas limits. An Envio indexer. 445 unit tests and e2e on a fork. Evidence is real testnet hashes. |
| Monad integration | 9 | Live commit-state strip (`monadNewHeads`), two-timer receipts via `eth_sendRawTransactionSync`, txpool status, Mera passkeys verified by the P256 precompile, staking precompile reads, the 10 MON reserve rule, limit billing. Measured live: executed in 416 ms, final in 579 ms. |
| Track fit (01, Onchain Finance & Trading) | 8 | Coins graduate into their own Kuru order books, perps sit on Perpl with Agora AUSD margin, and pre-IPO trackers carry a Chainlink CRE-attested NAV. |
| Innovation | 7.5 | "Every post is a market" with a real graduation into an order book is new. Social launchpads are a crowded idea. |

Weighted: **about 8.0 / 10**.

## Bounties (requirements 40 / technical 30 / Monad 20 / innovation 10)

Strongest are Kuru New Markets, Perpl Risk, Chainlink CRE and Mera, each with a live transaction ([SPONSOR-COVERAGE.md](SPONSOR-COVERAGE.md)). The weakest claims:
- **MetaMask** and **Kimi**: their owner steps are not done.
- **Privy**: the dashboard origins and gas sponsorship are pending.

## Fit
- **Product-market:** creators want a cut of attention, and traders want early, liquid markets. A curve that graduates into a real book is a credible bridge. Retention is unproven.
- **Hackathon:** a strong fit. Monad's speed is the visible product moment (the receipt), and most sponsors are load-bearing rather than badges.

## Top 5 weaknesses, and what would make a judge say no
1. **Demo content, not users.** Every coin was made by `demo_` wallets. A judge may read it as staged. (Labelled honestly; nothing to fix before the deadline.)
2. **Privy sign-in on the hosted app** depends on the owner adding the origin in Privy's dashboard. Until then, use Passkey or the device key. (Owner, `doitlater.md`.)
3. **The agent story (MetaMask plugin + Kimi) can't be shown live:** `mm` is not installed, and Juno may not use the shared Kimi key.
4. **Duplicate "Live on Monad" on desktop.** Fixed: the tape now lives in the left rail only.
5. **Long captions** on the landing figures. Fixed: "to confirm (median)".

The likely "no": a judge who never makes a wallet sees only the feed. The landing's live panel and the one-tap passkey are the counter.
