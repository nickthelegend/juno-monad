# Deploying Juno on Monad

Four pieces, deployed in this order. Testnet (chain 10143) throughout; mainnet
is the same steps with `mainnet` and funded keys.

| | What | Where it can run |
|---|---|---|
| **Contracts** | `JunoLaunchpad`, `UniswapV2Graduator` (+ the v2 factory on testnet), `KuruGraduator` (testnet) | Monad, via Foundry |
| **Indexer** | Envio HyperIndex over the launchpad (`indexer/`) | Envio Cloud, or locally with Docker |
| **API** | The Next.js server at the repo root | Any Node host that keeps a process running (Railway, Render, Fly) — it holds a WebSocket to Monad for the live tape |
| **App** | The Expo app (`juno-expo/`) — web export, or iOS/Android builds | Vercel/Netlify for web; EAS for stores |

## 1. Contracts

Needs Foundry (≥ 1.8.0 recommended — `foundryup` — for Monad's gas model in
local simulation; 1.7.x deploys correctly) and a funded deployer. A launch
costs ~2.1M gas and the deploy ~7.6M on testnet; Monad charges the gas
*limit*, so the scripts pad estimates by 7.5–10%, not 30%.

```bash
git submodule update --init --recursive
cd contracts
cast wallet import monad-deployer --interactive      # once
export DEPLOYER_ACCOUNT=monad-deployer
export DEPLOYER_ADDRESS=$(cast wallet address --account monad-deployer)
./deploy.sh testnet --dry-run                         # simulate; nothing is sent
./deploy.sh testnet                                   # type "testnet" to broadcast + verify on MonadVision
```

Fund the deployer at <https://faucet.monad.xyz>. The script checks the chain
id, refuses an empty deployer, simulates first, writes
`deployments/10143.json`, verifies through Sourcify on MonadVision, and prints
the lines the API needs:

```
NEXT_PUBLIC_MONAD_NETWORK=testnet
NEXT_PUBLIC_JUNO_LAUNCHPAD=0x…
JUNO_LAUNCHPAD_DEPLOY_BLOCK=…
NEXT_PUBLIC_JUNO_USDC=0x534b2f3A21130d7a60830c2Df862319e593943A3
JUNO_KURU_GRADUATOR=0x…
```

On testnet the script also deploys a `KuruGraduator` against Kuru's testnet
Router (`0x7EFb…4630`) and MarginAccount (`0xd029…CE02`) and offers it to
creators with `setGraduatorAllowed`. It skips it on mainnet, where only Kuru's
own Safe may create markets (`JUNO_KURU=false` skips it anywhere). A launch
that chooses Kuru must be priced in MON.

The end-to-end test against Kuru's live testnet contracts is opt-in:

```bash
KURU_FORK_TEST=1 forge test --match-contract KuruGraduatorForkTest --threads 1
```

Testnet has no official Uniswap v2, so the script deploys the unmodified
v2-core factory; mainnet uses Uniswap's own (`0x182a…0f59`). Either way the
graduator is given the factory's pair init code hash, and the script checks it
against an existing pair before sending anything.

## 2. Indexer

```bash
cd indexer
pnpm install
cp .env.example .env
#   ENVIO_JUNO_TESTNET_LAUNCHPAD=<launchpad>   ENVIO_JUNO_TESTNET_START_BLOCK=<deploy block>
#   ENVIO_JUNO_TESTNET_KURU_GRADUATOR=<kuru graduator, if deployed>
#   ENVIO_API_TOKEN=<token from envio.dev>  — or, with no token, ENVIO_TESTNET_RPC_FOR=sync
pnpm dev                                    # Docker: Postgres + Hasura on :8080
```

GraphQL is then at `http://localhost:8080/v1/graphql`. For Envio Cloud, connect
the repo, set the same `ENVIO_*` variables in the project settings, and use
the endpoint it gives you. The free tier deletes idle deployments after about a
week, so deploy or redeploy it close to judging.

Set `ENVIO_GRAPHQL_URL` on the API to that endpoint. With it, trade history,
holders and portfolios come from the indexer; without it, the API falls back to
receipts it recorded and a bounded log tail — it keeps working either way.

## 3. API

```bash
npm install
cp .env.local.example .env.local            # fill in — see below
npm run db:migrate
npm run build && npm start
```

| Variable | Needed | Why |
|---|---|---|
| `NEXT_PUBLIC_MONAD_NETWORK`, `NEXT_PUBLIC_JUNO_LAUNCHPAD`, `JUNO_LAUNCHPAD_DEPLOY_BLOCK` | yes | From step 1. |
| `DATABASE_URL` | yes | Postgres: pools, posts, trades, follows, plans, watchlist. |
| `MONGODB_URI`, `MONGODB_DB` | yes | Comments, likes, names, the sealed faucet key. |
| `PINATA_JWT` | yes | Media and token metadata on IPFS. |
| `JUNO_KEY_SECRET` | yes (testnet) | Seals the faucet key at rest. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `MONAD_RPC_URL`, `JUNO_LOG_RANGE` | recommended | A dedicated RPC and its `eth_getLogs` range (100 on the public one). Never sent to the app. |
| `MONAD_WS_URL` | optional | WebSocket for the live commit-state tape; defaults to Monad's public one. |
| `ENVIO_GRAPHQL_URL` | recommended | Step 2. |
| `JUNO_KURU_GRADUATOR` | optional (testnet) | From step 1. Offers the Kuru venue at launch and trades Kuru-graduated coins on their market. |
| `PYTH_API_KEY` | optional | Fresh equity marks for stock trackers; MON/USD needs no key. |
| `JUNO_APP_URL` | recommended | The app's web URL. Page requests to the API redirect there. |
| `FAUCET_AMOUNT_MON` | optional | MON per faucet request (default 0.5). |

**Fund the faucet.** `GET /api/juno/faucet` returns the address of a key the
server generated and sealed itself. Send it testnet MON and "Get testnet MON"
works for everyone. No private key is ever pasted anywhere. Monad keeps a
10 MON reserve on accounts that send value, so keep the faucet above that.

**Keep the log tail current.** A cron hitting `GET /api/juno/index` every
minute walks the launchpad's log forward, so trades made outside the app are
recorded even without the indexer.

After deploying:

```bash
curl https://<api>/api/juno/config        # network, chainId, launchpad, explorer
curl https://<api>/api/juno/coins?limit=3
curl https://<api>/api/juno/live           # "connected": true once the tape is open
```

## 4. App

`juno-expo/.env` (or EAS environment variables):

```
EXPO_PUBLIC_API_URL=https://<api>
EXPO_PUBLIC_APP_URL=https://<app>
```

**Web:**

```bash
cd juno-expo
npm install
npm run export:web                          # dist/, with share tags and the SPA rewrite
npx vercel deploy dist --prod
```

**iOS / Android:** `eas build -p android --profile preview` for an installable
APK; `--profile production` plus `eas submit` for the stores (needs Apple
Developer / Play Console accounts). A local Android release build:
`npx expo prebuild --platform android && cd android && ./gradlew assembleRelease`.

## What must be configured outside this repo

- **Faucet MON** for the deployer and the server's faucet key.
- **Envio**: an API token (or RPC sync mode) and, for hosting, an Envio Cloud project.
- **Privy** (if the embedded-wallet signer is used): the app id, and in the
  Privy dashboard the app's web domain, the native bundle id `fun.juno.app`
  and URL scheme `juno`, and fee sponsorship on Monad testnet.
- **Pyth**: a Hermes API key for live equity marks.
