# Juno, end to end on a production build, local fork (6 Oct 2026)

The regression for Metropolis, with no testnet transactions and no
deploys. Everything runs on this machine:

| | |
|---|---|
| Chain | anvil fork of Monad testnet on `:8555` (`--prune-history 300`), forked at block 68,487,286, so Juno's real testnet contracts, Perpl, Kuru, Pyth and Chainlink's feeds are all on it |
| API | `next build` + `next start` (production) on `:3150`, from a clean clone at the commit under test |
| App | Expo web export (`juno-expo/dist-fork`) on `:8183` |
| Data | Fresh Postgres and Mongo databases. Demo content was seeded through the production API with `scripts/juno-demo.ts --round all`: 12 launches, trades, comments, and two lifecycle coins graduated into Uniswap v2 and into Kuru, then traded on each venue |
| Indexer | None (no Envio). The API's own log tail was started at the fork block and caught up through `/api/juno/index`, as the hosted cron keeps it. Pre-fork history (only $GENESIS) is not re-read locally |

## Results

| Suite | Result |
|---|---|
| App regression A–H (`.juno/rerun.mjs`, Playwright in headless Chrome, a fresh visitor each run) | **59 PASS, 1 UNTESTED** (B7), **0 console or network problems** |
| API harness I (`.juno/api-rerun.mjs`, 88 calls from the app's origin) | **88 / 88** |
| Autopilot fixture E2E (`scripts/e2e/autopilot-fork.ts`) | **21 / 21** |
| MetaMask plugin and Kimi agent loop (`mm-plugin-juno/scripts/fork-e2e.ts`) | **11 / 11** |
| Mera passkey accounts (`.juno/mera-e2e.mjs`) | create in 1 prompt; 0 prompts in session; End session, then 1 prompt; cleared storage, then the same account; **0 problems** |
| Sealed drafts (`.juno/drafts-e2e.mjs`) | sealed; server holds only the vault; wiped, signed back in, opened; deleted; **0 problems** |

**B7 (Privy sign-in) is UNTESTED here.** Privy only opens on the origins its
dashboard allows. Locally that is `:3000`, which another project is using
today, so this build runs without a Privy app id. B7 passed on the hosted
app (`E2E-HOSTED.md`).

## Found and fixed on the way

| Run | Found | Fix |
|---|---|---|
| 1 (55/60) | E9, D9, G6: with no indexer, the coin page's first read took 8.8 s and the leaderboard 73 s. The API's log tail sat 1.15M blocks behind, behind blocks a fork can only fetch from the public RPC 100 at a time. | Environment: the tail was started at the fork block and caught up (0.6 s and 0.24 s after). On hosted, Envio serves this. |
| 2 (57/60) | **F3: without an indexer, a wallet could not see or cancel its resting Kuru orders.** The orders route answered `null`. | **Fixed in the app** (2414d56). Juno now remembers every `OrderCreated` from the receipts of transactions it submits, and the route reads those ids against the book. F3: bid placed, cancelled, withdrawn. |
| 2 | E9's check expected the indexer's freshness wording. Without one, the caption says the balances are live. | Harness accepts either caption; both are accurate. |
| — | The harnesses had ports hardcoded (`:3000`, `:3100`, `:8545`). | `APP`, `API_ORIGIN` and `FORK_RPC` are read from the environment. |

Earlier on 6 Oct, also on this fork:
- the Perpl bot opened and closed a real BTC short (`PERPL-BOT.md`);
- a Chainlink CRE report went through Monad's MockKeystoneForwarder into
  `JunoNavOracle`, and the coin page showed the attestation
  (`cre/README.md`).
