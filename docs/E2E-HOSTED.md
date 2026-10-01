# Juno on Monad — the hosted demo, end to end (real testnet, 2026-10-01)

The deployment a judge opens: the web app on Vercel, the API, indexer and
databases on Railway, the contracts on Monad testnet. Every item is run in a
real browser (Claude in Chrome, and headless Google Chrome for timing and
media), against **real Monad testnet** — real MON, real signed transactions,
real IPFS, real Tessera/Pyth/Perpl/Kuru. The item IDs are the local-net
plan's (`docs/E2E-PLAN.md`); "correct" is restated where testnet or hosting
changes it.

| | URL |
|---|---|
| App | https://juno-monad-app.vercel.app |
| API | https://juno-api-production-04ea.up.railway.app |
| Launchpad | `0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81` (block 67,263,771) |

## Rules

- **PASS** = the result is exactly the definition, the console shows no error
  or warning from the app, and no request in the flow fails or answers
  4xx/5xx unless the item is about that answer. The one standing exception is
  Base Account's cross-origin-opener check: a `HEAD` to the page whose 200
  arrives and whose body is never read, which Chrome lists as aborted.
- On-chain numbers are checked against the chain (`cast`, MonadVision), not
  against the app.
- **UNTESTED** only where a dependency genuinely does not exist here, said
  per item.

## X. Hosting

| ID | Item | Correct means | Status |
|---|---|---|---|
| X1 | App on Vercel | `/` 200; a deep link (`/coin/<token>`, `/trader/<wallet>`) loads that screen directly (SPA rewrite) | |
| X2 | API on Railway | `GET /api/juno/config` 200: chainId 10143, the launchpad, `localFork: false`; a page request to the API redirects (307) to the app | |
| X3 | Privy origin | Loading the app raises no Privy error (the origin is allowed); the Privy modal opens | |
| X4 | Indexer | Hosted Envio is caught up (`behind: 0`) and a coin's trades and holders from it equal the chain | |
| X5 | Log-tail cron | `juno-index-cron` runs every 5 min and its last run succeeded; `/api/juno/index` reports `caughtUp` | |
| X6 | Demo content | The feed opens on real coins with photos and reels by named creators, with trades, comments and a chart — not an empty app | |
| X7 | Faucet | `GET /api/juno/faucet` shows a funded key; "Get testnet MON" pays a new wallet 0.5 MON on chain | |

## A–K

The local-net plan's items, run on the hosted app. Definitions are as in
`docs/E2E-PLAN.md` with these changes for real testnet:

- A1: the badge reads "Monad testnet" (no "local fork"); `config.localFork` is false.
- B2–B4: the faucet is the hosted one (X7); B4 is checked while it is empty.
- C3/C6/C9: uploads go through the hosted API to Pinata.
- D10: Monad's real staged commits (Proposed → Voted → Finalized → Verified).
- E3: "confirmed on Monad testnet in N s", with a MonadVision link that opens the transaction.
- E14: "Claimed — view the transaction" opens MonadVision.
- G5: Perpl on real testnet needs testnet AUSD — UNTESTED if Agora's faucet is dry (it was on 29 Sep).
- J1: the hosted indexer (X4).
- J7: done on real testnet in `docs/E2E-PLAN.md` Phase 6 ($GENESIS).

Results are recorded below as the run goes.

## Results
