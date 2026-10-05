# Juno on Monad: the Metropolis plan

**Updated:** 6 Oct 2026. **Submissions close:** 13 Oct 2026, 11:59 pm ET.
The September migration plan is archived at
[`docs/PLAN-MIGRATION-2026-09.md`](docs/PLAN-MIGRATION-2026-09.md).

Standing constraints, from the user:
- **Monad testnet is on hold**: no transactions, no Railway or Vercel
  redeploys, until the user funds the deployers and says go. Testnet-only
  items are marked *awaiting testnet go*.
- **On-chain work uses real contracts and real signed transactions on a local
  anvil fork of Monad testnet.**
- **No production mocks, fixture modes or fallback data.** A missing
  credential shows an honest "not configured" state, and its items are
  UNTESTED or BLOCKED with the exact key named.

Status tags: **DONE** (verified, with evidence), **IN PROGRESS**, **NOT
STARTED**, **BLOCKED** (with the user action that unblocks it).

## Goals

**Done** means three things:
- every feature and flow below works on a production build against the local
  fork, verified in a real browser with a clean console and network;
- every sponsor bounty Juno enters meets its stated requirement, or is
  recorded as blocked with the exact reason;
- the judge package is complete and the deploy runbook takes under an hour
  from "go".

**Winning** in Track 01 (Onchain Finance & Trading) is judged 20% each on
product quality, technical excellence, Monad integration, track fit and
innovation. Bounties are judged 40% on meeting the stated requirement. So:
- a polished, honest product first;
- each bounty's literal requirement met and evidenced;
- then depth.

## Phases (critical path marked ★)

1. ★ **Sponsor features**: built with tests and a local E2E (phase 1 of the orchestration).
2. ★ **No production mocks**: remove fixture modes from the running product.
3. ★ **Completeness audit**: every screen at 375px on a production build, console clean.
4. ★ **Zero-mock verification**: [`docs/TEST-PLAN-ZERO-MOCK.md`](docs/TEST-PLAN-ZERO-MOCK.md), run in a real browser.
5. **Quality gate**: suites, typecheck, lint, contracts and Slither, secret scan.
6. ★ **Judge package**: README, SUBMISSION.md, [`docs/DEPLOY-LATER.md`](docs/DEPLOY-LATER.md).
7. **Testnet go** (*awaiting the user*): fund, deploy, redeploy hosting, smoke test, video.

## Tasks

| # | Task | Acceptance | Verify | Status |
|---|---|---|---|---|
| 1.1 | Kuru New Markets and Consumer write-ups | Required fields filled in `docs/METROPOLIS.md` | Read | DONE |
| 1.2 | Perpl risk view | Live funding, skew, liquidation distance | Hosted E2E (5 Oct), `tests/unit/juno-perp-risk.test.ts` | DONE |
| 1.3 | Perpl bot | Opens and closes on Perpl with caps and a kill switch | 10 unit tests; fork run (`docs/PERPL-BOT.md`) | DONE |
| 1.4 | Mera on the web (UX, Many Keys) | One ceremony, sessions, stateless; sealed drafts | `.juno/mera-e2e.mjs`, `.juno/drafts-e2e.mjs` on a prod build | DONE |
| 1.5 | Mera in the native apps | Mera's RN client, associated domain | `tests/unit/juno-expo-mera-native.test.ts` | DONE (code). Ceremony **BLOCKED**: Apple team id, Android release cert |
| 1.6 | Privy autopilot (session signers, policies, sponsorship) | Policy per wallet; signer added and confirmed; plans run; `sponsor: true` | Policy and SDK-call unit tests | Code DONE. Live **BLOCKED**: Privy signer setup plus testnet go (Privy broadcasts to testnet) |
| 1.7 | Chainlink CRE `juno-nav` | Workflow and receiver; simulate | 7 + 9 tests, WASM build, fork report through MockKeystoneForwarder | Code DONE. Simulate **BLOCKED**: `cre login` |
| 1.8 | MetaMask Agent Wallet plugin | `mm juno …` installs and trades through `walletExecutor` | 20 tests, fork E2E, runs in `mm` 7.0.0 | DONE. Live buy **BLOCKED**: `mm login` |
| 1.9 | Kimi (`mm juno ask`) | Kimi plans with tool calls that trade | Request-shape and loop tests | Code DONE. Live **BLOCKED**: `MOONSHOT_API_KEY` |
| 1.10 | Kuru orders without an indexer | List and cancel resting orders without Envio | F3 on a prod build, unit test | DONE |
| 2.1 | Remove autopilot's fixture mode | Only `privy` or `off`; off shows "not set up" | Grep for `fixture` in the product path; app shows the state | DONE: product is Privy-only; the card shows "Not set up"; 6 unit tests on doubles (`tests/unit/juno-autopilot.test.ts`) |
| 2.2 | Remove the Kimi fixture planner from the command | `ask` without a key says the key is missing | Run `mm juno ask` without the key | DONE: the planner lives in `mm-plugin-juno/test/`; the command names `MOONSHOT_API_KEY` |
| 3.1 | Screen walk at 375px on a prod build | Every screen renders; no overflow; empty, loading and error states present; console clean | `tests/e2e/walk.mjs` (committed) | NOT STARTED |
| 4.1 | Zero-mock test plan, every item run | PASS / FAIL / UNTESTED per item; 0 console or network errors | `docs/TEST-PLAN-ZERO-MOCK.md` | NOT STARTED |
| 5.1 | Quality gate | All suites green; tsc clean; lint clean; Slither; no secrets tracked | Commands recorded below | NOT STARTED |
| 6.1 | README judge package | One-command demo; new vs pre-existing; AI disclosure; why Monad; architecture diagram; sponsors | Read | IN PROGRESS |
| 6.2 | SUBMISSION.md | Portal fields per bounty, evidence links, 3-minute demo script with timestamps | Read | IN PROGRESS |
| 6.3 | `docs/DEPLOY-LATER.md` | Ordered runbook: addresses and MON, keys and where set, deploy and verify, hosting, smoke test, shot list | Read; under 1 hour | NOT STARTED |
| 7.1 | Fund deployers; deploy `JunoNavOracle`; redeploy API, indexer and web | Hosted app on HEAD | Post-deploy smoke test | **BLOCKED**: testnet go and MON |
| 7.2 | Video, 3 minutes or less | Recorded from the shot list | — | **BLOCKED**: testnet go (hosted app on HEAD) |

## Gap audit (from the code, 6 Oct)

The grep for `mock|stub|fake|dummy|placeholder|TODO|FIXME|hardcod|fixture`
over `lib/`, `app/`, `juno-expo/`, `mm-plugin-juno/src`, `cre/` and
`scripts/` found the following. The many `Placeholder` hits are the kit's
empty-state component, and "placeholder" in comments, not gaps.

| Gap | Evidence | Impact | Sev | Fix | Blocks |
|---|---|---|---|---|---|
| Autopilot has a fixture mode in the running product. Without Privy keys, a local fork impersonates the wallet. | `lib/juno/autopilot.ts:42-54`, `juno-expo/components/Autopilot.tsx:48-110`, `app/api/juno/autopilot/route.ts:19` | A mock path reachable through an env var | P1 | Remove it; `off` shows "not set up". Keep the real logic covered by unit tests with doubles. | 2.1 |
| The Kimi fixture planner can be selected in the shipped command (`JUNO_KIMI_FIXTURE=1`) | `mm-plugin-juno/src/lib/agent.ts:129-156`, `src/commands/juno/ask.ts` | Same | P1 | Move it to `test/`; the command needs the key | 2.2 |
| No linter configured | No eslint or biome config | Quality gate item | P2 | Add a lint step with clean results | 5.1 |
| Hosted app is behind HEAD (no autopilot, CRE line, Kuru order receipts, native Mera) | Railway and Vercel last deployed 5 Oct | Judges see the 5 Oct build | P1 | Runbook 6.3; redeploy at go | 7.1 |
| `JunoNavOracle` not on testnet | — | The CRE attestation line is absent on hosted | P2 | Runbook: deploy with the MockKeystoneForwarder for simulate, the production forwarder for deploy | 7.1 |
| Native Mera ceremony unverified | Needs signing identities | Agora's mobile requirement only partly evidenced | P1 | Owner provides team id and cert; runbook | 1.5 |

`juno-expo/lib/privy.tsx` describes itself as a "stub", but it is the types
module TypeScript resolves. iOS, Android and web load `privy.native.tsx` or
`privy.web.tsx` at runtime, so it is not in the product path. No old-chain
copy (`solana|SOL|phantom|devnet`) and no "coming soon" text remain in
product code.

## Completion

The 100% checklist (30 items, equal weight):
- **Features, flows and data (8):** feed and social; coin and trading on
  curve, v2 and Kuru; graduation; perps, faucet and risk; trackers; plans,
  watch and alerts; portfolio, trader and leaderboard; persisted data.
- **Wallets and auth (4):** device key; Privy web; Mera web; Mera native.
- **Bounties (10):** Kuru ×2; Perpl risk; Perpl bot; Agora; Mera ×2;
  Envio; Privy beyond login; CRE.
- **Agent bounties (2):** MetaMask plugin; Kimi.
- **Tests and quality (3):** suites green; zero-mock verification; quality
  gate.
- **Ship (3):** runbook; README and SUBMISSION; hosted on HEAD with video.

**Initial (6 Oct, start of this pipeline): 21 / 30 = 70%.**
- Done: 8 features and flows, device key, Privy web (hosted 5 Oct), Mera
  web, Kuru ×2, Perpl risk, Perpl bot, Agora (web), Mera ×2, Envio,
  MetaMask plugin, suites green.
- Not done:
  - Mera native (blocked);
  - Privy beyond login, CRE and Kimi (fixture modes or blocked keys);
  - zero-mock verification;
  - quality gate;
  - runbook, README and SUBMISSION (partial);
  - hosted on HEAD (blocked).

**Final:** see the end of this file once the pipeline completes.
