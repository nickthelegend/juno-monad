# mm-plugin-juno

A [MetaMask Agent Wallet](https://docs.metamask.io/agent-wallet/) plugin that
lets `mm` trade **Juno's coins on Monad**. On Juno every post is a coin. Each
one trades on its own bonding curve, then, once the curve fills, on a Uniswap
v2 pair or its own Kuru order book. `mm`'s built-in swaps don't reach those
markets. This plugin does.

```
mm juno markets [--sort marketCap|graduating] [--limit N]
mm juno coin <token>
mm juno buy <token> <amount> [--slippage-bps N]     # amount in the coin's quote token (MON or USDC)
mm juno sell <token> [percent]                      # default 100: the whole holding, to the wei
mm juno portfolio
mm juno ask "<what to do, in words>" [--max-spend N] [--dry-run]   # Kimi plans it
```

Every command takes `--api` (or `JUNO_API_URL`). The default is the hosted
Monad testnet deployment.

## How a trade goes

1. The plugin asks Juno's API to build the trade for the selected wallet
   (`POST /api/juno/tx/swap`). Juno picks the venue the coin trades on now:
   its curve, its v2 pair through Juno's router, or its Kuru book. It sets the
   slippage floor and a deadline, and adds a USDC approval first when one is
   needed. A sell is read from the chain, so 100% sells exactly the balance.
2. Each step goes to the Agent Wallet's executor
   (`ctx.walletExecutor(io, "juno:buy")`), with an intent that says what it
   is: `Juno: buy 1 MON of 0x… on its curve`. The wallet signs and sends it
   under its own rules (Guard mode, simulation, 2FA). Juno never sees a key.
3. Steps are sent in order, each waiting for the last. If a later one fails,
   the result says which ones already landed.

The plugin checks what Juno built before anything is signed: the chain must
be Juno's, and every step must be for the selected wallet. A trade Juno
refuses (selling a coin you don't hold, a curve that is full) fails with
Juno's own sentence, before the wallet is asked.

## `mm juno ask`: Kimi plans the trade

`mm juno ask "buy 2 MON of the coin closest to graduating"` hands the request
to Kimi (Moonshot's `kimi-k2.6`, `MOONSHOT_API_KEY`) with five tools, which
are the commands above: `markets`, `coin`, `portfolio`, `buy`, `sell`. Kimi
decides which to call and in what order: look first, then trade. Its buys
and sells go through the same path as `mm juno buy`, so the Agent Wallet's
policy still applies to every transaction. The plugin bounds the rest:

- `--max-spend` caps what one request may spend per quote token (default 5),
  checked before a buy is built;
- `--dry-run` builds each trade with Juno and reports it, and sends nothing;
- a made-up token address is refused, and an unknown tool comes back to Kimi
  as an error;
- the loop stops after eight model turns.

Kimi's `reasoning_content` is sent back with each of its turns, as Moonshot
requires for its thinking models. Without a key, `JUNO_KIMI_FIXTURE=1` swaps
in a fixed planner, labelled `FIXTURE (not Kimi)` in the output, so the
tool loop can be tested.

## Permissions

| Command | Capabilities | Data |
|---|---|---|
| `juno:markets`, `juno:coin` | none (public market data) | none |
| `juno:portfolio` | `wallet-read` | accounts |
| `juno:buy`, `juno:sell`, `juno:ask` | `wallet-read`, `wallet-submit` | accounts |

## Install (local)

```bash
npm install && npm run build
mm config set experimentalPlugins true
mm config set experimentalAllowUnverifiedInstalls true
mm plugins install "file:$PWD" --accept-permissions
mm juno markets
```

## Tests

- `npm test`: 20 unit tests. Nine are for `ask`: the Kimi request (tools,
  `tool_choice`, `reasoning_content` sent back), the tool loop, an unknown tool,
  the step limit, dry run and the spend cap. The other 11 cover:
  - the manifest, checked against MetaMask's own `PluginManifestSchema`;
  - step order, intents and partial failures in the submit loop;
  - Juno's refusals passed through as Juno's sentences;
  - wallet selection.
- `scripts/fork-e2e.ts`: the commands' `trade()` against Juno's API on a
  local fork of Monad testnet. 11 of 11 pass (6 Oct 2026):
  - buy on a curve, and buy on a graduated coin's Uniswap v2 pair;
  - sell 50% (exactly half, to the wei), then sell 100% (zero left);
  - Juno refuses a sell of nothing before anything is signed;
  - the portfolio shows what is held;
  - `ask` (with the fixture planner, since there is no Moonshot key here) listed
    markets and bought on chain, and the spend cap refused a buy over 3 MON.

  The one stand-in is the executor. `mm`'s goes through MetaMask's wallet
  service, which a fork cannot reach, so a fork key signs the same request
  shape instead.
- In the real `mm` 7.0.0: the plugin installs, `mm plugins` lists it, and
  `mm juno markets` / `mm juno coin` run against the fork. `mm juno buy`
  stops at `mm login`. A MetaMask Agent Wallet account is the owner's step.
