#!/usr/bin/env bash
# LOCAL FORK ONLY. Never point this at a real network: it impersonates accounts with anvil.
#
# A fork freezes Perpl's marks, and Perpl refuses to open positions against a
# mark older than 60s. To exercise Juno's perps UI on the fork, this keeper
# (1) as Perpl's owner, turns off the oracle-age check for BTC, ETH and MON,
# and (2) as a price admin, copies the live testnet mark onto the fork every
# 20 seconds. The fork's order book stays as it was at fork time.
# Optional: `fund <address> <ausd>` gives a fork wallet AUSD.
set -euo pipefail
RPC=${FORK_RPC:-http://127.0.0.1:8555}
EX=0x1964C32f0bE608E7D29302AFF5E61268E72080cc
OWNER=0x582ea4aBe762A303A934E5983a2CdDeC336193B1
ADMIN=0xd0b6c28090c79e3edf0d414d92e1f1e07009501d
AUSD=0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC
CORE=0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700

[[ "$(cast chain-id --rpc-url $RPC)" == "10143" ]] || { echo "not the fork"; exit 1; }
[[ "$(cast rpc anvil_nodeInfo --rpc-url $RPC 2>/dev/null | head -c 1)" == "{" ]] || { echo "not anvil"; exit 1; }

if [[ "${1:-}" == "fund" ]]; then
  WHO=$2; AMOUNT=$3
  SLOT=$(cast keccak "$(cast abi-encode 'f(address,bytes32)' "$WHO" $CORE)")
  VALUE=$(cast to-uint256 $(( AMOUNT * 1000000 * 256 )))
  cast rpc anvil_setStorageAt $AUSD "$SLOT" "$VALUE" --rpc-url $RPC >/dev/null
  echo "AUSD balance: $(cast call $AUSD 'balanceOf(address)(uint256)' "$WHO" --rpc-url $RPC)"
  exit 0
fi

if [[ "${1:-}" == "make" ]]; then
  # A local market maker (see perpl-maker.mts): rests real post-only BTC orders around the mark.
  cd "$(dirname "$0")/../.." && exec npx tsx scripts/fork/perpl-maker.mts
fi

for who in $OWNER $ADMIN; do
  cast rpc anvil_impersonateAccount $who --rpc-url $RPC >/dev/null
  cast rpc anvil_setBalance $who 0x56BC75E2D63100000 --rpc-url $RPC >/dev/null
done
for perp in 16 32 64; do
  cast send $EX "setIgnOracle(uint256,bool)" $perp true --from $OWNER --unlocked --rpc-url $RPC >/dev/null
done
echo "oracle-age check off for 16 32 64; mirroring marks every 20s"
while true; do
  # Perpl rate-limits its public API; a refused or garbled read skips this round, never ends the keeper.
  CONTEXT=$(curl -sf https://testnet.perpl.xyz/api/v1/pub/context || true)
  OK=0
  for perp in 16 32 64; do
    MARK=$(echo "$CONTEXT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const m=JSON.parse(s).markets.find(x=>x.id===$perp);console.log(m.state.mrk)}catch{}})" || true)
    [[ -n "$MARK" ]] || continue
    cast send $EX "updateMarkPricePNS(uint256,uint32)" $perp "$MARK" --from $ADMIN --unlocked --rpc-url $RPC >/dev/null && OK=$((OK + 1)) || echo "update $perp failed"
  done
  echo "$(date +%H:%M:%S) marks mirrored: $OK of 3"
  sleep 20
done
