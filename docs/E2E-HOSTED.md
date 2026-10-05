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

### 5 Oct — sponsor features, run in the hosted app on real testnet

All in the hosted app (built-in browser pane and headless Google Chrome),
real Monad testnet, console and network clean unless said.

| Item | Result |
|---|---|
| AUSD from Agora's faucet (new) | PASS. Perps card → "Get 10,000 test AUSD" → `requestFunds` signed by the wallet → "10,000 AUSD arrived from Agora's faucet"; `balanceOf` = 10,000.000000 on chain. The faucet's rules are checked before signing: during its one-minute global cooldown the server answers "Agora's faucet sends once every 60 seconds across everyone. Try again in N seconds." |
| G5 Perps on **real** Perpl testnet | PASS. Open account 150 AUSD → 2x BTC long 20 AUSD filled **0.00046 BTC at $85,937.80** against Perpl's live book → Done → Close → Withdraw all: 9,999.977918 AUSD back on chain (0.022 AUSD fees + spread). "View the transaction" opens MonadVision. FAIL→fixed on the way: the risk view kept a closed position until its next read; the faucet's success line outlived later actions; volatility printed as "+27%". |
| Perpl risk view (new) | PASS. Perps → Risk with the position open: "BTC long · 2.0x on equity · −46.0% to liquidation · $39.53 notional · equity $19.77 · margin 12.5× maintenance · funding −$0.0265/day · a 10% move against it: −$3.95"; per market funding a year (BTC +24.4%), the last day's 33 payments drawn as bars and their cost to a $1,000 long, premium to the oracle, realised volatility (BTC 27%), 24h range. |
| Kuru segment (new) | PASS (empty state). Trade → Kuru explains the markets Juno opens on Kuru and says none exist yet on this deployment — true until a Kuru-venue coin graduates on hosted testnet (needs MON). |
| Mera passkey account (new) | PASS — `.juno/mera-e2e.mjs`, Chrome's virtual authenticator with PRF: create = **1 passkey use**; only `{address, credentialId}` stored; first transaction (Agora faucet, signed by the session) **landed in 1.6 s with 0 prompts** (nonce 1, 10,000 AUSD on chain); a name claim in the session 0 prompts; End session → locked → next signature **exactly 1 prompt**, session reopened; **stateless test**: storage cleared → "Sign in with my passkey" → the **same address**. Note: the session is in memory by design, so a full page reload locks it (the next signature asks once). |
| Web copy | FAIL→fixed: "pull to refresh/retry" on the web in six places (faucet message, Trade, Social, Profile, Perps); the web now says the balance updates by itself or to reload the page. The wallet balance re-reads every 10 s (0.6 MON sent from outside appeared without a reload). |
| Sealed drafts — Mera "many keys" (new) | PASS — `.juno/drafts-e2e.mjs`: a passkey account seals a draft (name, ticker, caption) in the composer; the server holds only the vault (`version, credential, prfSalt, nonce, ciphertext`) with **no plaintext**; every byte of local storage wiped → "Sign in with my passkey" → **same account** → Open (one passkey prompt) fills the form with the sealed words → Delete → 0 drafts. UNTESTED here: a *second real device* — Chrome's virtual authenticator exports a credential without its PRF secret, so an imported copy cannot evaluate PRF; real synced passkeys (iCloud Keychain, Google Password Manager) carry it. Judges can check it on two of their own devices. |

