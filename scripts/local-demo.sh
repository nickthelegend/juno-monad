#!/usr/bin/env bash
# Juno on a local fork of Monad testnet, in one command.
#
#   npm run demo:local          # start: fork, databases, API (production build), seeded content, web app
#   npm run demo:local -- stop  # stop everything it started
#
# Needs, installed and on PATH: Foundry (anvil, cast), Node 22+, PostgreSQL 16
# (a running server your user can create databases on), and MongoDB 7
# (`mongod`). `npm install` at the root and in juno-expo/ first.
#
# What it does:
# - Builds the API (production) and the web app first, while nothing else
#   runs, to keep memory low. SKIP_BUILD=1 reuses the last builds.
# - Forks Monad testnet with anvil on :8555 (pruned history). Juno's real
#   testnet contracts, Perpl, Kuru, AUSD, Pyth and Chainlink's feeds are all
#   on the fork.
# - Makes a fresh Postgres database and Mongo data directory, and migrates.
# - Serves the API on :3150.
# - Funds the API's faucet key with fork MON.
# - Seeds the demo content through the API: twelve coins, trades, comments,
#   and two coins graduated into Uniswap v2 and Kuru, all as real signed
#   transactions on the fork.
# - Keeps Perpl's marks live on the fork (scripts/fork/perpl-keeper.sh).
# - Serves the web app on :8183.
#
# No keys are needed. PINATA_JWT (uploads) and Privy are optional; without
# them the app says so where they would be used. Nothing touches Monad
# testnet itself: every transaction lands on the local fork.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
RUN="$ROOT/.juno/demo-local"
RPC_PORT=${RPC_PORT:-8555}
API_PORT=${API_PORT:-3150}
APP_PORT=${APP_PORT:-8183}
DB=${DEMO_DB:-juno_demo_local}
RPC="http://127.0.0.1:$RPC_PORT"
API="http://localhost:$API_PORT"
APP="http://localhost:$APP_PORT"
mkdir -p "$RUN/logs"

# Stops only what this script started: the PID it recorded, and whatever
# then listens on that service's own port (npx puts a wrapper process in
# front of the server).
stop() {
  for entry in "web:$APP_PORT" "keeper:" "api:$API_PORT" "mongod:27018" "anvil:$RPC_PORT"; do
    name=${entry%%:*}; port=${entry#*:}
    [[ -f "$RUN/$name.pid" ]] || continue
    pids="$(cat "$RUN/$name.pid")"
    [[ -n "$port" ]] && pids="$pids $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)"
    for pid in $pids; do kill "$pid" 2>/dev/null || true; done
    echo "stopped $name"
    rm -f "$RUN/$name.pid"
  done
}

if [[ "${1:-}" == "stop" ]]; then
  stop
  exit 0
fi

need() { command -v "$1" >/dev/null || { echo "Needs $1 on PATH ($2)." >&2; exit 1; }; }
need anvil "Foundry: https://getfoundry.sh"
need cast "Foundry"
need node "Node 22+"
need psql "PostgreSQL 16"
need createdb "PostgreSQL 16"
need mongod "MongoDB 7"
for port in $RPC_PORT $API_PORT $APP_PORT 27018; do
  if lsof -ti "tcp:$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is in use. Stop what holds it, or set RPC_PORT / API_PORT / APP_PORT." >&2
    exit 1
  fi
done

trap 'echo "A step failed: logs are in $RUN/logs. Stopping what this run started." >&2; stop' ERR

DEPLOY="$ROOT/contracts/deployments/10143.json"
json() { node -e "console.log(require('$DEPLOY')['$1'] ?? '')"; }
cat > "$RUN/env" <<EOF
NEXT_PUBLIC_MONAD_NETWORK=testnet
MONAD_RPC_URL=$RPC
NEXT_PUBLIC_JUNO_LAUNCHPAD=$(json launchpad)
JUNO_LAUNCHPAD_DEPLOY_BLOCK=0
JUNO_SWAP_ROUTER=$(json swapRouter)
JUNO_KURU_GRADUATOR=$(json kuruGraduator)
NEXT_PUBLIC_JUNO_USDC=$(json usdc)
JUNO_LOG_RANGE=1000
DATABASE_URL=postgresql://localhost:5432/$DB
DATABASE_URL_UNPOOLED=postgresql://localhost:5432/$DB
DATABASE_DIRECT_URL=postgresql://localhost:5432/$DB
MONGODB_URI=mongodb://127.0.0.1:27018
MONGODB_DB=juno_demo
JUNO_KEY_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
JUNO_APP_URL=$APP
NEXT_PUBLIC_SITE_URL=$APP
ENVIO_GRAPHQL_URL=
MONAD_WS_URL=
JUNO_SCRIPT_PRIVATE_KEY=
JUNO_NAV_ORACLE=
EOF
# These win over a developer's .env.local (Next.js never overrides a variable
# that is already set, even to empty). Optional keys there, such as
# PINATA_JWT, still apply.
set -a; . "$RUN/env"; set +a

# Both builds first, while nothing else runs: building next to a fork, two
# databases and a server is the memory peak this order avoids. SKIP_BUILD=1
# reuses the last builds.
if [[ "${SKIP_BUILD:-}" == "1" && -d .next && -d juno-expo/dist-local ]]; then
  echo "1/8 Builds: reusing the last ones (SKIP_BUILD=1)"
else
  echo "1/8 Building the API (production) and the web app"
  ./node_modules/.bin/next build --webpack > "$RUN/logs/build.log" 2>&1
  (cd juno-expo && EXPO_PUBLIC_API_URL=$API EXPO_PUBLIC_APP_URL=$APP EXPO_PUBLIC_PRIVY_APP_ID= npx expo export --platform web --output-dir dist-local > "$RUN/logs/export.log" 2>&1)
fi

echo "2/8 Forking Monad testnet on :$RPC_PORT"
anvil --fork-url https://testnet-rpc.monad.xyz --chain-id 10143 --port "$RPC_PORT" --block-time 1 \
  --prune-history 300 --silent --fork-retry-backoff 500 --retries 8 --timeout 30000 > "$RUN/logs/anvil.log" 2>&1 &
echo $! > "$RUN/anvil.pid"
for _ in $(seq 1 60); do cast block-number --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 1; done
FORK_BLOCK=$(cast block-number --rpc-url "$RPC")
echo "    forked at block $FORK_BLOCK"
# The launchpad's history on this fork starts here (read at runtime, not built in).
sed -i.bak "s/^JUNO_LAUNCHPAD_DEPLOY_BLOCK=.*/JUNO_LAUNCHPAD_DEPLOY_BLOCK=$FORK_BLOCK/" "$RUN/env" && rm -f "$RUN/env.bak"
set -a; . "$RUN/env"; set +a

echo "3/8 Databases"
# Fresh every run, like the Postgres database: the API seals its faucet key in
# Mongo under this run's JUNO_KEY_SECRET, which a previous run's data cannot
# be opened with.
rm -rf "$RUN/mongo" && mkdir -p "$RUN/mongo"
mongod --dbpath "$RUN/mongo" --port 27018 --bind_ip 127.0.0.1 > "$RUN/logs/mongod.log" 2>&1 &
echo $! > "$RUN/mongod.pid"
dropdb --if-exists "$DB" && createdb "$DB"
# A fresh fork starts the demo content over (the demo wallets' keys are kept).
[[ -f .juno/demo/fork/progress.json ]] && mv .juno/demo/fork/progress.json "$RUN/progress.previous.json"
npx drizzle-kit migrate > "$RUN/logs/migrate.log" 2>&1

echo "4/8 Starting the API"
./node_modules/.bin/next start -p "$API_PORT" > "$RUN/logs/api.log" 2>&1 &
echo $! > "$RUN/api.pid"
for _ in $(seq 1 120); do curl -sf "$API/api/juno/config" >/dev/null && break; sleep 1; done
curl -sf "$API/api/juno/config" >/dev/null || { echo "The API did not start: see $RUN/logs/api.log" >&2; false; }

echo "5/8 Funding the faucet"
FAUCET=$(curl -s "$API/api/juno/faucet" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).address??"")}catch{console.log("")}})')
[[ "$FAUCET" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "The API did not name its faucet address: see $RUN/logs/api.log" >&2; false; }
cast rpc anvil_setBalance "$FAUCET" 0x3635C9ADC5DEA00000 --rpc-url "$RPC" > /dev/null

echo "6/8 Perpl marks"
FORK_RPC=$RPC bash scripts/fork/perpl-keeper.sh > "$RUN/logs/keeper.log" 2>&1 &
echo $! > "$RUN/keeper.pid"

echo "7/8 Seeding the demo (a few minutes: every trade is a signed transaction)"
JUNO_API_URL=$API npx tsx scripts/juno-demo.ts --api "$API" --rpc "$RPC" --round all > "$RUN/logs/seed.log" 2>&1 \
  || { echo "Seeding failed: see $RUN/logs/seed.log. Stopping what this run started." >&2; stop; exit 1; }

echo "8/8 Serving the web app"
npx --yes serve juno-expo/dist-local -s -l "$APP_PORT" > "$RUN/logs/web.log" 2>&1 &
echo $! > "$RUN/web.pid"
for _ in $(seq 1 60); do curl -sf "$APP" >/dev/null && break; sleep 1; done
curl -sf "$APP" >/dev/null || { echo "The web app did not start: see $RUN/logs/web.log" >&2; false; }

cat <<EOF

Juno is running on a local fork of Monad testnet.
  App   $APP
  API   $API
  Fork  $RPC   (chain 10143)

Open the app, Create wallet, Get testnet MON, and trade. Every transaction is
real and signed, on the fork. Privy sign-in is off here: it only opens on the
origins Juno's Privy app allows. Logs are in .juno/demo-local/logs.
Stop it all with: npm run demo:local -- stop
EOF
