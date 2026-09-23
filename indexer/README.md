# Juno indexer

An [Envio HyperIndex](https://docs.envio.dev/docs/HyperIndex/overview) indexer for the Juno launchpad on Monad. Every post on Juno launches its own ERC-20 on a bonding curve held by one contract, `JunoLaunchpad`. This indexer records every launch, trade, completion, graduation and fee claim from the chain's first relevant block, and serves them over GraphQL.

The app needs it because Monad's public RPC answers `eth_getLogs` over at most 100 blocks, which is about 40 seconds of chain. Without an indexer the app can only see recent trades: what it records itself plus a short tail of logs. With `ENVIO_GRAPHQL_URL` set, trade history, charts, portfolios and the leaderboard can all read complete data from here.

- `config.yaml`: the contract, its events, and both Monad networks. Addresses and start blocks come from the environment.
- `schema.graphql`: the entities below.
- `src/EventHandlers.ts`: the handlers. `src/math.ts` holds unit conversion and pricing; `src/quotes.ts` resolves quote-token decimals.
- `test/indexer.test.ts`: handler tests on simulated events. They need no network, database or Docker.

## What it indexes

| Source | Events |
| --- | --- |
| `JunoLaunchpad` (address from env) | `Launched`, `Trade`, `CurveCompleted`, `Graduated`, `CreatorFeesClaimed`, `ProtocolFeesClaimed`, `QuoteAllowed`, `GraduatorSet`, `ProtocolShareSet` |
| `JunoToken` (every launched token, registered from `Launched`) | `Transfer` |

Each token is added to the index when it is launched, a factory pattern that uses `contractRegister`. HyperIndex backfills the whole creation block, so the constructor's mint is seen too. Indexing token transfers is what gives each position a real balance, and each pool a holder count, instead of numbers inferred from trades alone.

### Entities

| Entity | id | What it holds |
| --- | --- | --- |
| `Trade` | `${txHash}:${logIndex}` | One buy or sell: trader, side, base, quote, fee and price in display units (also the raw integers), the curve price and quote reserve after it, block and timestamp. |
| `Pool` | token address | Launch parameters (creator, quote, preset, name, symbol, uri, venue, curve bounds, supply split). Live state: sqrt price, spot price, last price, base and quote reserve. Totals: trades, buys, sells, volume, fees, creator fees earned and claimed, holder count. Lifecycle: complete, graduated, liquidity, burned. |
| `Position` | `${trader}-${token}` | One address in one pool. `balance` is the actual ERC-20 balance. `netBase`, `bought`, `sold`, `spent`, `received` and `feesPaid` come from trades. It also carries an average-cost basis (`basisBase`, `costBasis`) and `realizedPnl`, using the same policy as the app's `basisFromSwaps`. |
| `Account` | address | Trade, buy, sell and launch counts, pools traded, first seen and last trade. It links to the account's `trades` and `positions`. |
| `QuoteToken` | quote address (`0x0…0` is MON) | Decimals, whether launches may use it, and pool, trade, volume, fee and protocol-fee totals. Volumes only add up within one quote, so the protocol-wide totals are kept per quote. |
| `Launchpad` | launchpad address | Graduator, protocol share, and pool, trade, completed and graduated counts. |
| `Graduation` | token address | The migration into the AMM pair: amounts, LP liquidity, amount burned, tx. |
| `CreatorClaim` | `${txHash}:${logIndex}` | A creator withdrawing fees. |

**Units.** `BigDecimal` fields are display units. Base amounts are tokens (18 decimals). Quote amounts are in the pool's quote token: native MON has 18 decimals and USDC has 6 (testnet `0x534b…43A3`, mainnet `0x7547…b603`). For any other quote, `decimals()` is read once through an Effect. Fields ending in `Raw`, plus `sqrtPriceX96` and `liquidity`, are the contract's own integers. Prices are `quote / base` in display units, kept to 30 significant digits.

**Serialisation.** Envio's Hasura returns `BigInt` and `BigDecimal` as strings, and `Int` as a number. Filter on addresses with their EIP-55 checksummed form, which is what the indexer stores.

**Chains.** Rows are per chain (`disable_default_cross_chain: true`), so every entity has a generated `chainId`. If one deployment indexes both networks, add `chainId: {_eq: 10143}` (or `143`) to your `where`.

## Configuration

Copy `.env.example` to `.env` and fill it in. Envio only passes through variables that start with `ENVIO_`, and Envio Cloud only accepts that prefix, so the app's names are prefixed here:

| Variable | Default | Notes |
| --- | --- | --- |
| `ENVIO_API_TOKEN` | none | Required for HyperSync. Get one at <https://envio.dev/app/api-tokens>. |
| `ENVIO_JUNO_TESTNET_LAUNCHPAD` | `0x0…0` | The testnet `JunoLaunchpad` (the app's `NEXT_PUBLIC_JUNO_LAUNCHPAD`). |
| `ENVIO_JUNO_TESTNET_START_BLOCK` | `0` | Its deployment block (the app's `JUNO_LAUNCHPAD_DEPLOY_BLOCK`). |
| `ENVIO_JUNO_SKIP_MAINNET` | `true` | Set to `false` once there is a mainnet launchpad. |
| `ENVIO_JUNO_MAINNET_LAUNCHPAD` | `0x0…0` | |
| `ENVIO_JUNO_MAINNET_START_BLOCK` | `0` | |
| `ENVIO_MONAD_TESTNET_RPC_URL` / `ENVIO_MONAD_RPC_URL` | public RPCs | Only used to read `decimals()` of an unfamiliar quote token. |

> **The launchpad isn't deployed yet.** Until it is, the address defaults to a placeholder that never emits anything. The indexer runs and stays empty.
>
> **The start block must not be later than the launchpad's deployment.** The constructor emits `ProtocolShareSet` and `QuoteAllowed(MON)`, and pools inherit the fee split from those. A trade on a pool whose `Launched` event was missed is skipped with an error log rather than stored with guessed decimals. Setting `0` is safe, because HyperSync skips empty ranges.

HyperSync endpoints: `https://monad-testnet.hypersync.xyz` (10143) and `https://monad.hypersync.xyz` (143). HyperIndex picks these automatically from the chain id.

## Run it locally

Prerequisites: Node 22 or later (24 is recommended), pnpm, and Docker. Docker runs Postgres and Hasura for `envio dev`.

```bash
cd indexer
pnpm install
cp .env.example .env        # then set ENVIO_API_TOKEN and the launchpad address
pnpm dev                    # envio dev: codegen, start Postgres + Hasura, index
```

GraphQL is served at `http://localhost:8080/v1/graphql`. The Hasura console is at `http://localhost:8080` and the admin secret is `testing`. After changing `config.yaml` or `schema.graphql`, restart from scratch with `pnpm envio dev -r`. Stop everything with `pnpm stop`.

Checks that need no Docker or network:

```bash
pnpm codegen     # validates config.yaml + schema.graphql, regenerates .envio/types.d.ts
pnpm typecheck   # tsc over handlers and tests
pnpm test        # vitest: simulated events through the real handlers
```

## Host it on Envio Cloud

1. Sign in at <https://envio.dev/app> with GitHub. Pick an organisation and install the Envio Deployments GitHub app on this repository.
2. **Add indexer**. Set the root directory to `indexer`, the config file to `config.yaml`, and choose a deployment branch (for example `envio`).
3. Under **Settings → Environment Variables**, set the `ENVIO_JUNO_*` variables from the table above. Envio Cloud indexers need no `ENVIO_API_TOKEN`.
4. Push to the deployment branch. Each push builds a new deployment that re-indexes from the start block. The previous deployment keeps serving until the new one catches up.
5. Copy the deployment's GraphQL endpoint from the dashboard.

Envio Cloud needs the `envio` version pinned in `package.json` (it is `3.12.1`) and a pnpm-compatible lockfile (`pnpm-lock.yaml` is committed). On the free development plan, a deployment is deleted after 30 days. Hitting a soft limit (100k events processed, 5 GB, or 7 days without a query) starts an earlier deletion countdown. Every trade is two events here (the `Trade` and its token `Transfer`). See [the deployment docs](https://docs.envio.dev/docs/HyperIndex/hosted-service-deployment).

## How the app uses it

Set the endpoint in the app's root `.env.local`:

```bash
ENVIO_GRAPHQL_URL=https://indexer.dev.hyperindex.xyz/<deployment-id>/v1/graphql   # or http://localhost:8080/v1/graphql
```

`lib/juno/envio.ts` then reads trade history from here instead of from the receipt record and the bounded log tail (see `lib/juno/swaps.ts`). It queries `Trade` by `token` or `trader` with `_eq` on checksummed addresses, orders by `blockNumber` and `logIndex` descending, and maps each row onto `PoolSwap` with `Number(...)`.

### Example queries

A token's trades, newest first (this is the query the app runs):

```graphql
query TokenTrades($token: String!) {
  Trade(
    where: { token: { _eq: $token } }
    order_by: [{ blockNumber: desc }, { logIndex: desc }]
    limit: 200
  ) {
    id txHash logIndex token trader isBuy
    baseAmount quoteAmount fee price
    blockNumber timestamp
  }
}
```

A wallet's portfolio: what it holds, what it paid, and what it has realised:

```graphql
query Portfolio($trader: String!) {
  Position(
    where: { trader: { _eq: $trader }, balance: { _gt: "0" } }
    order_by: { balance: desc }
  ) {
    token balance
    basisBase costBasis realizedPnl
    spentQuote receivedQuote tradeCount lastTradeAt
    pool { name symbol quote quoteDecimals spotPrice graduated }
  }
}
```

The value of a position is `balance × pool.spotPrice`. Average cost is `costBasis / basisBase`.

Top MON-quoted pools by volume:

```graphql
query TopPools {
  Pool(
    where: { quote: { _eq: "0x0000000000000000000000000000000000000000" } }
    order_by: { volumeQuote: desc }
    limit: 20
  ) {
    id name symbol creator
    volumeQuote tradeCount holderCount
    spotPrice quoteReserve migrationQuoteThreshold
    complete graduated
  }
}
```

Progress to graduation is `quoteReserve / migrationQuoteThreshold`. Market cap is `spotPrice × 1,000,000,000`.

Realised-profit leaderboard for MON pools. Sum per `trader` client-side, or rank single exits as is:

```graphql
query Leaderboard {
  Position(
    where: { realizedPnl: { _gt: "0" }, pool: { quote: { _eq: "0x0000000000000000000000000000000000000000" } } }
    order_by: { realizedPnl: desc }
    limit: 100
  ) {
    trader token realizedPnl tradeCount
  }
}
```

Whether the indexer has caught up:

```graphql
{ _meta { chainId progressBlock sourceBlock isReady } }
```

## Notes

- **`balance` and `netBase` can differ.** `balance` follows every ERC-20 transfer. `netBase` counts only curve trades. A wallet that received tokens by transfer holds them with no cost basis, and selling them realises nothing (the app's policy). The launchpad's own inventory and the zero address are never positions.
- **Holder count** counts addresses with a positive balance, excluding the launchpad. After graduation the AMM pair counts as a holder, as it does on explorers.
- **After graduation**, trading moves to the AMM pair. This indexer records the graduation but not swaps on the pair, so `spotPrice` stays at the curve's final price.
