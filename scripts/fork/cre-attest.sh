#!/usr/bin/env bash
# Chainlink CRE's juno-nav on a LOCAL FORK: deploy JunoNavOracle, then deliver
# one attestation through Monad testnet's MockKeystoneForwarder, as
# `cre workflow simulate --broadcast` would (cre/juno-nav/fork-attest.ts).
#
#   bash scripts/fork/cre-attest.sh deploy <rpc> <run-dir>   # prints the oracle's address
#   bash scripts/fork/cre-attest.sh attest <rpc> <run-dir>   # one report, once the trackers exist
#
# Logs go to <run-dir>/logs/cre.log; the key and config stay in <run-dir>. Uses a fresh key funded on the fork, never a real one,
# and refuses any RPC that is not on this machine.
set -euo pipefail

MODE=${1:?deploy or attest}
RPC=${2:?rpc}
RUN=${3:?run dir}
[[ "$RPC" =~ ^http://(127\.0\.0\.1|localhost): ]] || { echo "cre-attest only runs against a local fork" >&2; exit 1; }
cd "$(dirname "$0")/../.."
LOG="$RUN/logs/cre.log"

# Monad testnet's MockKeystoneForwarder (Chainlink's forwarder directory).
FORWARDER=0xB9F79d863261869B234c481D1f9A7af84AeAd192

if [[ "$MODE" == "attest" ]]; then
  (cd cre/juno-nav && FORK_RPC="$RPC" FORK_PRIVATE_KEY="$(cat "$RUN/cre.key")" bun fork-attest.ts "$RUN/cre-config.json") >> "$LOG" 2>&1
  exit 0
fi

: > "$LOG"
KEY=$(cast wallet new --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s)[0].private_key))')
( umask 077; echo "$KEY" > "$RUN/cre.key" )
ADDRESS=$(cast wallet address --private-key "$KEY")
cast rpc anvil_setBalance "$ADDRESS" 0xDE0B6B3A7640000 --rpc-url "$RPC" > /dev/null

BYTECODE=$(node -e 'console.log(require("./contracts/out/JunoNavOracle.sol/JunoNavOracle.json").bytecode.object)')
ARGS=$(cast abi-encode "constructor(address)" "$FORWARDER")
ORACLE=$(cast send --rpc-url "$RPC" --private-key "$KEY" --create "${BYTECODE}${ARGS#0x}" --json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).contractAddress))')
echo "JunoNavOracle $ORACLE (forwarder $FORWARDER)" >> "$LOG"

node -e '
  const config = require("./cre/juno-nav/config.local-fork.json");
  config.receiver = process.argv[1];
  require("fs").writeFileSync(process.argv[2], JSON.stringify(config, null, 2));
' "$ORACLE" "$RUN/cre-config.json"
echo "$ORACLE"
