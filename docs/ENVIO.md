# How Juno uses Envio: full history on a chain whose public RPC remembers 100 blocks

*Juno · Monad Metropolis, Track 01 · live at https://juno-monad-app.vercel.app (Monad testnet)*

Juno is a social feed where every post is a market. A photo or a reel launches its own coin on a bonding curve on
Monad in one transaction. Fans buy it straight from the feed, and the creator earns the trading fees. When a curve
fills, the coin graduates into its own Kuru order book (or a Uniswap v2 pair, if the creator chose that at
launch).

## The problem Envio solves: "who holds this?" on a fast chain

A coin page needs every trade, every holder and each holder's average cost, and after graduation the trades and
resting orders on its Kuru market or v2 pair. A portfolio needs every position a wallet has taken.

Monad's public RPC answers `eth_getLogs` over at most 100 blocks. At Monad's block time that is well under a
minute of chain. Without an indexer, Juno can only see what it recorded itself (receipts of transactions it
submitted) plus a short tail of logs. Any trade made outside the app, any transfer between wallets, and anything
older than the tail would be missing.

Envio's HyperIndex reads the chain from the launchpad's deployment block through HyperSync. It keeps derived
entities in Postgres and serves them over GraphQL, so "every holder" becomes a query.

## How it works

### 1. One launchpad, every token, every venue

[`indexer/config.yaml`](../indexer/config.yaml) indexes `JunoLaunchpad` (launches, trades, completion,
graduation, fee claims). Contracts the launchpad creates are registered as they appear: every `JunoToken`, each
coin's Uniswap v2 pair, the `KuruGraduator`, and each Kuru market it opens. From
[`indexer/src/EventHandlers.ts`](../indexer/src/EventHandlers.ts):

```ts
indexer.contractRegister({ contract: "JunoLaunchpad", event: "Launched" }, async ({ event, context }) => {
  context.chain.JunoToken.add(event.params.token);
  // The v2 pair it will graduate into, whose address is fixed from here on.
  if (isV2Lock(event.chainId, event.params.venue)) context.chain.UniswapV2Pair.add(event.params.venue);
});
```

```ts
indexer.contractRegister({ contract: "KuruGraduator", event: "KuruMarketOpened" }, async ({ event, context }) => {
  context.chain.KuruMarket.add(event.params.market);
});
```

Only markets Juno opened are indexed, not all of Kuru.

### 2. Derived entities

[`indexer/schema.graphql`](../indexer/schema.graphql) defines more than raw events:
- **Position**: one wallet in one coin. Its real ERC-20 balance comes from `Transfer`s, and an average-cost basis
  and realised P&L come from trades, using the same policy as the app.
- **Pool**: live price and reserves; volume, fee and creator-fee totals; holder count; lifecycle.
- **KuruMarket**, **KuruTrade** and **KuruOrder**: fills on a graduated coin's book, plus each resting limit
  order's remaining size and status (open, filled or cancelled).
- **V2Pair** and **PairTrade** for the v2 venue; **Account**, **Graduation** and **CreatorClaim**.

Holder counts move only when a balance crosses zero. The launchpad, the zero address and the venue's lock (the
pair, or Kuru's MarginAccount) are excluded as holders:

```ts
const isHolder = (address: string) =>
  !sameAddress(address, ZERO_ADDRESS) && !sameAddress(address, pool.launchpad) && !sameAddress(address, pool.lock);
```

A position the curve built carries across graduation. A Kuru fill updates the same `Position` row the curve
trades did, with Kuru's taker fee taken from what the order receives.

### 3. The API consumes it, and says how current it is

[`lib/juno/envio.ts`](../lib/juno/envio.ts) queries the GraphQL endpoint for trades, holders, positions, pool
stats and open Kuru order ids. It also reads Envio's `_meta`, so the API can report how far behind the chain the
indexer is:

```ts
/** How far behind the chain head the indexer is — so "complete" is a measured claim. */
export async function envioStatus(): Promise<IndexerStatus | null> {
  const data = await query<{ _meta: Array<{ chainId: number; progressBlock: number; sourceBlock: number; isReady: boolean }> }>(
    `{ _meta { chainId progressBlock sourceBlock isReady } }`,
```

When a coin's holders come from the indexer, the coin route
([`app/api/juno/coins/[token]/route.ts`](../app/api/juno/coins/%5Btoken%5D/route.ts)) returns
`holdersSource: "indexer"` and `indexer: { progressBlock, behind }`. "Every holder" is then only claimed up to the
block the indexer has processed. Open Kuru orders combine both sources: the indexer names the order ids a wallet
placed, and the app reads each one from the book's `s_orders` so filled or cancelled orders drop out right away.

## Engineering notes

- **The constructor's mint.** A token's mint to the launchpad is emitted before `Launched`. HyperIndex backfills
  the whole creation block for a newly registered contract, so the mint is seen, and the handler ignores
  transfers for a pool it doesn't know yet.
- **The start block matters.** The launchpad's constructor emits `ProtocolShareSet` and `QuoteAllowed(MON)`, and
  pools take their fee split from those. A start block after deployment would miss them. A trade on a pool whose
  `Launched` was missed is logged as an error and skipped, rather than stored with guessed decimals.
- **Kuru's events have no indexed fields.** Everything is in the data, and `isBuy` is the taker's side, so the
  handlers decode accordingly.
- **RPC fallback.** HyperSync is the primary source. The config keeps the public RPC as a fallback, with its block
  interval capped at 100 to match its `eth_getLogs` limit.
- **Receipts as a second source.** For transactions Juno submits, `recordReceiptKuruFills` writes rows with the
  same ids the indexer uses, so a fill shows up straight away and the two sources merge without double counting.
- 10 handler tests on simulated events, with no network or database.

## The value it brought

- **Complete data on Monad.** Holders, cost basis, portfolios and the leaderboard come from the full history, not
  from a 100-block window.
- **One view across venues.** A wallet's position in a coin stays the same row from its first curve buy through
  Kuru fills after graduation.
- **Measured claims.** `indexer.behind` says how current the data is.

## Live proof (Monad testnet)

The indexer is self-hosted on Railway beside Juno's API (services `envio-indexer` and `envio-hasura`), and
has served the hosted app since 1 Oct. Its GraphQL endpoint sits behind Juno's API. To check it from outside, call
the API:

```
GET https://juno-api-production-04ea.up.railway.app/api/juno/coins/0x2DA4841d9694Ae7Ac6D609D824EbD9A1FBf96754
```

On 14 Oct this returned the $BLOOM coin with `holdersSource: "indexer"` and
`indexer: { progressBlock: 70810481, behind: 0 }`. On 13 Oct the hosted indexer served holders for the newly
seeded coins, 0 blocks behind the chain. Indexing has no transactions of its own; the trades it indexed are
listed in [evidence/testnet-13oct.md](evidence/testnet-13oct.md) and
[evidence/seed-13oct.md](evidence/seed-13oct.md). The seeded trades are team activity, not organic usage.

## Honest limits

- **Self-hosted, not Envio's hosted service.** It runs on Railway. Juno does not publish its GraphQL endpoint; the
  outside proof is the API's `holdersSource` and `indexer.behind`.
- **Little data.** Testnet activity is a handful of team-seeded coins and trades.
- **Testnet only.** The mainnet chain is configured but skipped until a mainnet launchpad exists.
- Without `ENVIO_GRAPHQL_URL`, the API falls back to receipts and the log tail, which is less complete.
