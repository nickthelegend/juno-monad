#!/usr/bin/env bash
#
# Deploy Juno to Monad.
#
#   ./deploy.sh testnet                simulate, confirm, broadcast, verify
#   ./deploy.sh mainnet
#   ./deploy.sh testnet --dry-run      simulate only; nothing is sent
#   ./deploy.sh testnet --no-verify    deploy without verifying (verify later)
#
# Nothing is ever sent without you typing the network name at the prompt, and
# the script refuses to run without a terminal to ask you on. It is for a human
# to run by hand; nothing in this repo calls it.
#
# What it does, in order:
#   1. checks the RPC really is the chain you named (`cast chain-id`);
#   2. prints the forge version and warns below 1.8.0 (see "Foundry" below);
#   3. simulates script/Deploy.s.sol against the live chain — no transactions —
#      and shows the addresses it would create (deployments/<id>.dry-run.json);
#   4. refuses if the deployer holds no MON, warns if it holds less than the
#      simulation's estimate;
#   5. asks you to type the network name, then broadcasts and verifies on
#      MonadVision (Sourcify). The record lands in deployments/<chainid>.json and
#      the app's env vars are printed at the end.
#
# Signer — one of:
#   DEPLOYER_ACCOUNT=<name> DEPLOYER_ADDRESS=0x…
#       an encrypted keystore in ~/.foundry/keystores (recommended). Create it
#       with `cast wallet import <name> --interactive`; its address is
#       `cast wallet address --account <name>`. You are asked for the password
#       once, at broadcast.
#   DEPLOYER_PRIVATE_KEY=0x…
#       read by Deploy.s.sol from the environment; never put on a command line.
#
# Optional: JUNO_OWNER, JUNO_PROTOCOL_SHARE_BPS, WMON, JUNO_USDC,
# UNISWAP_V2_FACTORY (see script/Deploy.s.sol), MONAD_TESTNET_RPC / MONAD_RPC
# for a dedicated RPC. contracts/.env is loaded if present.
#
# Foundry: Monad asks for forge >= 1.8.0, which executes locally with Monad's
# gas schedule, hardfork and precompiles (`--network monad`, added here
# automatically when available). 1.7.x still deploys correctly — it already
# sizes each transaction's gas limit from the Monad node's own eth_estimateGas
# for chains 143/10143 and sends them one at a time — but its local traces and
# "Estimated amount required" use Ethereum gas prices. Upgrade: `foundryup`.
#
# Gas: Monad charges the full gas LIMIT, not the gas used, so the estimate is
# padded by 10% (--gas-estimate-multiplier 110) instead of forge's default 30%.

set -euo pipefail

cd "$(dirname "$0")"

usage() {
  echo "usage:" >&2
  sed -n '5,8p' "$0" | sed 's/^#//' >&2
  exit 1
}

NETWORK="${1:-}"
[[ $# -gt 0 ]] && shift
DRY_RUN=0
DO_VERIFY=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-verify) DO_VERIFY=0 ;;
    *) usage ;;
  esac
done

# contracts/.env, if present. Variables already in the environment win — the
# same rule forge's own .env loading follows — so a one-off override on the
# command line is never silently replaced by the file.
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    name="${BASH_REMATCH[2]}"
    value="${BASH_REMATCH[3]}"
    [[ -n "${!name+set}" ]] && continue
    value="${value%\"}" && value="${value#\"}"
    value="${value%\'}" && value="${value#\'}"
    export "$name=$value"
  done <.env
fi

case "$NETWORK" in
  testnet)
    CHAIN_ID=10143
    RPC_URL="${MONAD_TESTNET_RPC:-https://testnet-rpc.monad.xyz}"
    ;;
  mainnet)
    CHAIN_ID=143
    RPC_URL="${MONAD_RPC:-https://rpc.monad.xyz}"
    ;;
  *) usage ;;
esac

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

for tool in forge cast; do
  command -v "$tool" >/dev/null || die "$tool not found. Install Foundry: https://getfoundry.sh"
done

# ---- 1. The RPC is the chain we think it is ---------------------------------

say "Monad $NETWORK (chain $CHAIN_ID) via $RPC_URL"
ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")" || die "cannot reach $RPC_URL"
[[ "$ACTUAL_CHAIN_ID" == "$CHAIN_ID" ]] ||
  die "RPC reports chain $ACTUAL_CHAIN_ID, expected $CHAIN_ID for $NETWORK. Refusing."

# ---- 2. Foundry version -----------------------------------------------------

FORGE_VERSION_LINE="$(forge --version | head -n 1)"
FORGE_VERSION="$(printf '%s' "$FORGE_VERSION_LINE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
echo "$FORGE_VERSION_LINE"
IFS=. read -r V_MAJOR V_MINOR _ <<<"${FORGE_VERSION:-0.0.0}"
NETWORK_FLAGS=()
if ((V_MAJOR > 1 || (V_MAJOR == 1 && V_MINOR >= 8))); then
  NETWORK_FLAGS=(--network monad)
else
  warn "forge ${FORGE_VERSION:-?} < 1.8.0: local simulation uses Ethereum gas rules, not Monad's."
  warn "Gas limits still come from the Monad node's estimate, so the deploy itself is sound."
  warn "Run 'foundryup' to get Monad-native simulation (and '--network monad')."
fi

# ---- Signer -----------------------------------------------------------------

SIM_SIGNER=()
BROADCAST_SIGNER=()
if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "Signer: DEPLOYER_PRIVATE_KEY (from the environment)"
elif [[ -n "${DEPLOYER_ACCOUNT:-}" ]]; then
  [[ -n "${DEPLOYER_ADDRESS:-}" ]] ||
    die "set DEPLOYER_ADDRESS to the address of keystore '$DEPLOYER_ACCOUNT' (cast wallet address --account $DEPLOYER_ACCOUNT)"
  echo "Signer: keystore '$DEPLOYER_ACCOUNT' ($DEPLOYER_ADDRESS)"
  # Simulating needs only the address; the keystore is unlocked once, to broadcast.
  SIM_SIGNER=(--sender "$DEPLOYER_ADDRESS")
  BROADCAST_SIGNER=(--account "$DEPLOYER_ACCOUNT" --sender "$DEPLOYER_ADDRESS")
else
  die "no signer. Set DEPLOYER_ACCOUNT + DEPLOYER_ADDRESS (keystore), or DEPLOYER_PRIVATE_KEY."
fi

COMMON=(
  script/Deploy.s.sol:Deploy
  --rpc-url "$RPC_URL"
  --gas-estimate-multiplier 110
)
[[ ${#NETWORK_FLAGS[@]} -gt 0 ]] && COMMON+=("${NETWORK_FLAGS[@]}")

# ---- 3. Simulate against the live chain -------------------------------------

say "Simulating (nothing is sent)…"
SIM_LOG="$(mktemp -t juno-deploy.XXXXXX)"
trap 'rm -f "$SIM_LOG"' EXIT
if ! forge script "${COMMON[@]}" ${SIM_SIGNER[@]+"${SIM_SIGNER[@]}"} 2>&1 | tee "$SIM_LOG"; then
  die "simulation failed; nothing was sent"
fi
grep -q "SIMULATION COMPLETE" "$SIM_LOG" || die "simulation did not complete; nothing was sent"

DRY_RUN_JSON="deployments/$CHAIN_ID.dry-run.json"
DEPLOYER="$(sed -n 's/.*"deployer": *"\(0x[0-9a-fA-F]\{40\}\)".*/\1/p' "$DRY_RUN_JSON")"
[[ -n "$DEPLOYER" ]] || die "could not read the deployer from $DRY_RUN_JSON"

# ---- 4. The deployer can pay ------------------------------------------------

BALANCE_WEI="$(cast balance "$DEPLOYER" --rpc-url "$RPC_URL")"
say "Deployer $DEPLOYER holds $(cast from-wei "$BALANCE_WEI") MON"
[[ "$BALANCE_WEI" != "0" ]] || die "the deployer has no MON. Fund it first (testnet: the Monad faucet)."

NEEDED_MON="$(sed -n 's/^Estimated amount required: \([0-9.]*\) .*/\1/p' "$SIM_LOG" | tail -n 1)"
if [[ -n "$NEEDED_MON" ]]; then
  NEEDED_WEI="$(cast to-wei "$NEEDED_MON")"
  echo "Simulation estimates $NEEDED_MON MON of gas."
  # Big-number comparison without bc: equal-length zero-padded strings compare lexically.
  PAD_BAL="$(printf '%80s' "$BALANCE_WEI" | tr ' ' 0)"
  PAD_NEED="$(printf '%80s' "$NEEDED_WEI" | tr ' ' 0)"
  if [[ "$PAD_BAL" < "$PAD_NEED" ]]; then
    warn "the deployer holds less than the estimate. Monad charges every transaction's full gas"
    warn "limit up front, so a later transaction may be rejected after earlier ones land."
  fi
fi

if ((DRY_RUN)); then
  say "Dry run complete. Would-be addresses: $DRY_RUN_JSON"
  exit 0
fi

# ---- 5. Confirm, broadcast, verify ------------------------------------------

[[ -t 0 ]] || die "not a terminal: refusing to broadcast without an interactive confirmation."
if [[ "$NETWORK" == "mainnet" ]]; then
  warn "MAINNET. These contracts are permanent and launches on them trade real MON."
fi
printf '\nType "%s" to broadcast, anything else to stop: ' "$NETWORK"
CONFIRM=""
read -r CONFIRM || true
[[ "$CONFIRM" == "$NETWORK" ]] || die "not confirmed; nothing was sent."

# Verification on MonadVision goes through Sourcify and needs no API key.
# To verify on Monadscan (Etherscan v2 API) instead, replace VERIFY with:
#   VERIFY=(--verify --verifier etherscan --etherscan-api-key "$ETHERSCAN_API_KEY")
VERIFY=(--verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/)
BROADCAST_FLAGS=(--broadcast --slow)
((DO_VERIFY)) && BROADCAST_FLAGS+=("${VERIFY[@]}")

say "Broadcasting…"
forge script "${COMMON[@]}" ${BROADCAST_SIGNER[@]+"${BROADCAST_SIGNER[@]}"} "${BROADCAST_FLAGS[@]}"

say "Done. Record: deployments/$CHAIN_ID.json (transactions: broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json)"
cat "deployments/$CHAIN_ID.json"
SIGNER_HINT="${BROADCAST_SIGNER[*]:-}"
cat <<EOF

To verify (or finish a verification that failed part-way) without redeploying:
  forge script ${COMMON[*]}${SIGNER_HINT:+ $SIGNER_HINT} --resume ${VERIFY[*]}
or per contract:
  forge verify-contract <address> <Contract> --chain $CHAIN_ID ${VERIFY[*]:1}
EOF
