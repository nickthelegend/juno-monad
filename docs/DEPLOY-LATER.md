# Deploy later: from "go" to live in under an hour

The ordered runbook for when the user lifts the testnet hold. Nothing here
has been run since the hold began (6 Oct). The hosted app is still the
5 Oct build. Every step names who does it.
- **Owner** steps need the owner's money, accounts or secrets. Secrets are
  typed by the owner into Railway or a local shell, never into git.
- **Agent** steps can be run by anyone with the repo.

Estimated time: about 50 minutes, most of it waiting on builds.

## 0. What exists today

| | Where |
|---|---|
| Contracts (Monad testnet 10143) | `contracts/deployments/10143.json`: `JunoLaunchpad` `0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81` (from block 67,263,771), `UniswapV2Graduator` `0x6924937d7DDDD7D1c931Dc7a9779bD32F807FeAA`, `KuruGraduator` `0xBeFD5740896D157A3E9821939e5ba213BEf50F99`, `JunoSwapRouter` `0x648c6E84F779Cf20730Db26d49B7B950ca256366`, v2 factory `0xA81f5D4884d56B7F648bCAb6e6fcdc8b8f54fb81`. All verified on MonadVision. |
| Railway project `juno-monad` | `juno-api` (Next.js), `Postgres`, `MongoDB`, `juno-index-cron` (`curl …/api/juno/index` every 5 min), `envio-indexer`, `envio-hasura`, `Postgres-6Ajf` |
| Vercel project `juno-monad-app` | https://juno-monad-app.vercel.app, the web export |
| Deployer / owner | `0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC` (`.juno/deployer.key`, never committed): **10.97 MON** on 6 Oct, just above Monad's 10 MON reserve |
| Hosted faucet key (sealed by the API) | `0x8AeE933BD3F47Fc9a72589373ad6930a8141B0df`: **0 MON** |

## 1. MON (owner, about 5 minutes)

Monad keeps a 10 MON reserve on any account that sends value, so each
sender needs 10 MON more than it spends.

| Account | Send | For |
|---|---|---|
| Deployer `0x019E…CaaC` | **15 MON** | `JunoNavOracle` deploy and verify (under 0.1 MON). The demo content: four `demo_` wallets' trading money plus launch gas, about 12 MON (`scripts/juno-demo.ts --round all`, which also graduates a v2 coin and a Kuru coin, item T4). The rest is headroom over the reserve. |
| Hosted faucet `0x8AeE…B0df` | **20 MON** | 10 MON reserve plus 20 visitors × 0.5 MON (`GET /api/juno/faucet` shows the balance) |
| CRE simulate key (any fresh key the owner makes; put it in `cre/.env` as `CRE_ETH_PRIVATE_KEY`) | **1 MON** | Gas for `cre workflow simulate --broadcast` |
| Perpl bot key (`.juno/perpl-bot.key` → its address, from `npm run juno:perpl-bot -- status`) | **1 MON** (optional) | A live bot run. AUSD comes from Agora's faucet in the app. |

Sources: https://faucet.monad.xyz, or any funded testnet wallet.

## 2. Secrets and accounts (owner, about 10 minutes)

| Secret | Where it goes | Command |
|---|---|---|
| `PINATA_JWT` | Railway `juno-api` | `railway variables --service juno-api --set "PINATA_JWT=…"` (photo and reel launches need it) |
| `PRIVY_APP_SECRET` | Railway `juno-api` | `railway variables --service juno-api --set "PRIVY_APP_SECRET=…"` |
| Autopilot signer | Railway `juno-api` | Locally: `npm run juno:privy-setup`. It reads `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` from `.env.local`, registers a key quorum, and writes `.juno/privy-autopilot.env`. Then set `PRIVY_SIGNER_ID` and `PRIVY_AUTHORIZATION_KEY` from that file. |
| Gas sponsorship | Privy dashboard → Gas sponsorship → enable Monad testnet (10143) | Then `railway variables --service juno-api --set PRIVY_SPONSOR_GAS=1` |
| `JUNO_CRON_SECRET` | Railway `juno-api` and `juno-index-cron` | Any random string: `openssl rand -hex 24` |
| `cre login` | The owner's machine | `cre login` (browser sign-in to the owner's CRE account) |
| `mm login` | The owner's machine | `mm login` (MetaMask Agent Wallet account), for the plugin demo |
| `MOONSHOT_API_KEY` | The owner's shell | `export MOONSHOT_API_KEY=…`, for `mm juno ask` |
| Apple team id; Android release cert SHA-256 | Web export env | For native Mera, step 6 (optional) |

## 3. Contracts (agent, about 5 minutes)

`JunoNavOracle`, the CRE receiver. For the hackathon, CRE runs as a
simulation (`--broadcast`), which delivers through Monad testnet's
MockKeystoneForwarder, so deploy with that forwarder:

```bash
cd contracts
FORWARDER=0xB9F79d863261869B234c481D1f9A7af84AeAd192 forge script script/DeployNavOracle.s.sol \
  --rpc-url monad_testnet --private-key "$(cat ../.juno/deployer.key)" --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Record the address in `contracts/deployments/10143.json` (`navOracle`) and in
step 4's `JUNO_NAV_ORACLE`. A production CRE deployment (`cre workflow
deploy`, which needs CRE deploy access) uses the production forwarder
`0xF8344CFd5c43616a4366C34E3EEE75af79a74482` instead; redeploy with
`FORWARDER=` set to it, or call `setForwarderAddress`.

## 4. API, cron and indexer (agent, about 10 minutes)

```bash
railway link --project juno-monad --service juno-api
railway variables --service juno-api --set JUNO_NAV_ORACLE=<step 3 address>
railway up --service juno-api --detach            # migrations run as the pre-deploy step
```

Add the autopilot runner to the cron. In Railway, set `juno-index-cron`'s
start command to the following and give it the same `JUNO_CRON_SECRET`:

```bash
sh -c 'curl -sS --max-time 140 http://juno-api.railway.internal:8080/api/juno/index; curl -sS --max-time 140 -X POST -H "Authorization: Bearer $JUNO_CRON_SECRET" http://juno-api.railway.internal:8080/api/juno/autopilot/run'
```

The Envio indexer is unchanged since 5 Oct (`indexer/`); no redeploy is
needed.

## 5. Demo content and CRE (agent, about 10 minutes)

```bash
# Twelve coins, trades, comments and both graduations, through the hosted API, signed by demo wallets.
JUNO_API_URL=https://juno-api-production-04ea.up.railway.app npx tsx scripts/juno-demo.ts --round all
```

Then set up `cre/juno-nav/config.staging.json`:
- `receiver`: the step 3 address;
- `trackers`: the demo's Tessera trackers (OPENAIX, KALSHIX, SPACEXX).

Take each tracker's token and `nav_units_per_token` from
`GET /api/juno/coins?nav=1`; `unitsPerTokenE18` is that value × 1e18. Bands
are 200 / 500 / 400 for tight-nav / thin-name / ipo-book. The local fork's
`config.local-fork.json` shows the shape. Then run:

```bash
cd cre
cre workflow simulate juno-nav --target staging-settings --non-interactive --trigger-index 0 --broadcast
```

The coin pages of those trackers then show "Attested on Monad by Chainlink
CRE".

## 6. App (agent, about 10 minutes)

```bash
cd juno-expo
EXPO_PUBLIC_API_URL=https://juno-api-production-04ea.up.railway.app \
EXPO_PUBLIC_APP_URL=https://juno-monad-app.vercel.app \
APPLE_TEAM_ID=<optional> ANDROID_CERT_SHA256=<optional> npm run export:web
cd dist
npx vercel link --yes --project juno-monad-app --scope nicolas-projects-f497bb7f
npx vercel deploy --prod --yes
```

Privy's dashboard must list `https://juno-monad-app.vercel.app` (it does
since 5 Oct).

## 7. Smoke test (agent, about 5 minutes)

```bash
API=https://juno-api-production-04ea.up.railway.app
curl -s $API/api/juno/config | jq '{chainId, localFork, autopilot}'   # 10143, false, mode "privy" and sponsor true once step 2 is done
curl -s $API/api/juno/faucet                                           # balance ≥ 10.5
curl -s "$API/api/juno/coins?limit=3" | jq '.coins | length'           # 3
curl -s $API/api/juno/index | jq .caughtUp                             # true
APP=https://juno-monad-app.vercel.app API=$API node tests/e2e/walk.mjs # 43/43 screens, no console or network errors
APP=https://juno-monad-app.vercel.app node .juno/mera-e2e.mjs          # passkey account, sessions, same account after a wipe
```

Then by hand, on a phone browser:
- Profile → Get testnet MON;
- buy a post;
- Trade → Perps → Get AUSD → open and close 2x;
- Kuru → a market;
- the OPENAIX page shows the CRE attestation;
- Privy sign-in → Plans → Turn on autopilot.

## 8. Video, 3 minutes or less (owner records, from the hosted app)

The shot list, with timestamps and narration, is the demo script in
[SUBMISSION.md](SUBMISSION.md#demo-script-3-minutes). Record it once
steps 1–7 pass. Then put the links in SUBMISSION.md's project table.
