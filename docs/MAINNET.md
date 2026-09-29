# Monad mainnet — runbook

For a person to run, by hand, with their own key. Nothing in this repository
sends a mainnet transaction on its own: `contracts/deploy.sh mainnet` refuses
to broadcast until you type `mainnet` at its prompt.

Mainnet contracts are permanent, and launches on them trade real MON.

## What gets deployed

| Contract | Notes |
|---|---|
| `JunoLaunchpad` | Owner defaults to the deployer (`JUNO_OWNER` overrides); the protocol takes 20% of trading fees (`JUNO_PROTOCOL_SHARE_BPS`) |
| `UniswapV2Graduator` | Graduates into the **official** Uniswap v2 factory on Monad, `0x182a927119D56008d921126764bF884221b10f59`; the pair init-code hash is checked against mainnet's WMON/USDC pair. The script refuses to stand up a private v2 on mainnet |
| `JunoSwapRouter` | Trades graduated coins against their pairs |
| Quote tokens | MON (native, wrapped as WMON `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A`) and Circle USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Kuru | **Not deployed.** Kuru's mainnet Router lets only Kuru's own Safe create markets, so `JUNO_KURU=false` is required — without it the script stops with `Unconfigured("KURU_ROUTER")` |

## Cost

Simulated against `https://rpc.monad.xyz` on 29 Sep 2026 (forge 1.7.1, no
transaction sent): **6,327,488 gas, about 1.28 MON at 202 gwei**. Monad
charges each transaction's full gas limit, and the script pads estimates by
10%, so hold at least **2 MON** on the deployer.

## Before

1. Foundry ≥ 1.8.0 (`foundryup`): it simulates with Monad's own gas rules
   (`--network monad`). 1.7.x deploys correctly but its local estimate uses
   Ethereum's.
2. A keystore for the deployer — never a raw key on the command line:

   ```bash
   cast wallet import juno-mainnet --interactive
   ```

3. Fund its address (`cast wallet address --account juno-mainnet`) with ≥ 2 MON.

## Deploy

Simulate first; nothing is sent:

```bash
cd contracts && JUNO_KURU=false DEPLOYER_ACCOUNT=juno-mainnet DEPLOYER_ADDRESS=0x… ./deploy.sh mainnet --dry-run
```

Then the same without `--dry-run`. It simulates again, shows the balance
against the estimate, asks you to type `mainnet`, broadcasts one transaction
at a time and verifies each contract on MonadVision through Sourcify. The
record lands in `contracts/deployments/143.json`, and the app's variables are
printed at the end.

## After

**API** (`.env.local` on the host):

```
NEXT_PUBLIC_MONAD_NETWORK=mainnet
NEXT_PUBLIC_JUNO_LAUNCHPAD=<JunoLaunchpad>
JUNO_LAUNCHPAD_DEPLOY_BLOCK=<deployBlock from 143.json>
JUNO_SWAP_ROUTER=<JunoSwapRouter>
NEXT_PUBLIC_JUNO_USDC=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
JUNO_KURU_GRADUATOR=            # empty: no Kuru on mainnet
MONAD_RPC_URL=<a dedicated mainnet RPC>
```

The faucet answers only on testnet; on mainnet it returns 404.

**Indexer** (`indexer/.env`): `ENVIO_JUNO_SKIP_MAINNET=false`,
`ENVIO_JUNO_MAINNET_LAUNCHPAD=<JunoLaunchpad>`,
`ENVIO_JUNO_MAINNET_START_BLOCK=<deployBlock>`.

**App**: the landing badge reads the network from `/api/juno/config`; on
mainnet it drops "no real money".

## Proof, if you want one

Small and few — Metropolis disqualifies fake volume. From a wallet you own:
launch one post with a small first buy, buy and sell it once from a second
wallet, claim the creator fees. Put the transaction links in JUNO.md's
*On-chain proof* under a *Mainnet* heading, each with what it shows.
