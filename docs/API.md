# Juno API

The Next.js server at the repo root is an API for the Expo app in `juno-expo/`.
Every route lives under `/api/juno/`, answers JSON, allows any origin (the app's
web build is served from a different host), and answers `OPTIONS`.

Errors are `{ "error": "<a sentence a person can act on>" }` with a 4xx for a
caller problem, 503 when the RPC or a dependency is refusing, 500 otherwise.

## Conventions

- **Addresses** are EIP-55 checksummed `0x…` strings. The server accepts any
  case and normalises with `getAddress`.
- **Native MON** is the zero address, `0x0000000000000000000000000000000000000000`,
  wherever a token address is expected (quote tokens, balances).
- **`network`** is `"monad-testnet"` or `"monad"`. Every row is scoped to it.
- **Amounts** are UI units (`1.5` MON, not wei) unless a field says otherwise.
- A **coin's id is its token address**. On Monad a pool is keyed by its token
  inside the launchpad, so `coin.pool === coin.address`.

## Transactions

The server builds, the device signs, the server submits. Keys never leave the
phone.

```ts
type UnsignedTransaction = {
  label: string;               // "Buying", "Launching your post", …
  request: {
    type: "eip1559";
    chainId: number;           // 10143 testnet, 143 mainnet
    from: `0x${string}`;
    to: `0x${string}`;
    data: `0x${string}`;
    value: `0x${string}`;      // hex wei
    nonce: number;
    gas: `0x${string}`;
    maxFeePerGas: `0x${string}`;
    maxPriorityFeePerGas: `0x${string}`;
  };
};
```

Build routes return `steps: UnsignedTransaction[]`. Nonces are consecutive, so
the device signs every step up front and then submits them **in order**, each
waiting for the previous `submit` to answer. Most actions are one step; a buy
quoted in USDC is two the first time (approve, then buy).

The device signs with viem:

```ts
const signed = await account.signTransaction({
  ...step.request,
  value: BigInt(step.request.value),
  gas: BigInt(step.request.gas),
  maxFeePerGas: BigInt(step.request.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(step.request.maxPriorityFeePerGas),
});
```

| Route | Body | Answer |
|---|---|---|
| `POST tx/swap` | `{ token, owner, side: "buy"\|"sell", amountIn, slippageBps? }` | `{ steps, window: { deadline }, quote: { amountOut, minimumAmountOut, amountUsed, fee, priceImpact, curveImpact }, quoteSymbol, quoteUsdRate }` |
| `POST tx/launch` | `{ creator, name, symbol, preset, uri?, quoteToken?, initialMarketCap?, migrationMarketCap?, firstBuy? }` | `{ steps, token, launchpad, migrationQuoteThreshold }` — `token` is where the coin will be deployed, predicted by the launchpad |
| `POST tx/claim` | `{ creator, token }` | `{ steps }` — pays the creator their accrued trading fees |
| `POST tx/graduate` | `{ from, token }` | `{ steps }` — moves a filled curve into its AMM pair; anyone may send it |
| `POST tx/submit` | `{ signed: "0x…" }` | `{ hash, blockNumber, from, trades, launched?: { token, pair, creator }, graduated?: { token, venue }, completed?: [token] }` |
| `GET tx/balance` | `?wallet=&token=` | `{ wallet, token, symbol, decimals, balance }` — `balance` is null when the read failed |

`window.deadline` is unix seconds. A swap signed after it reverts on-chain with
`Expired`, so the app re-quotes rather than submitting a stale build.

`submit` waits for the receipt (Monad finalises in about a second), records any
trades the transaction made, and answers with what it did. A launch's `launched`
field is the confirmation to index the coin with `POST pools`.

## Configuration

| Route | Answer |
|---|---|
| `GET config` | `{ network, chainId, rpcUrl, launchpad, explorer, quoteTokens: QuoteToken[], faucet: boolean }` — `explorer` is the base URL; links are `${explorer}/tx/${hash}`, `/address/${a}`, `/token/${t}` |

## Coins

| Route | Notes |
|---|---|
| `GET coins` | `?limit&sort=marketCap\|graduating\|memes&social=1&viewer=&nav=1` → `{ network, coins: Coin[] }` |
| `GET coins/{token}` | `{ network, coin, activity, holders, holdersSource, crowd, launchTx }` |
| `GET depth` | `?token=&side=&impact=` |
| `POST pools` | Index a launch after `submit` confirmed it: `{ token, name, symbol, description?, format, curvePreset, mediaUrl?, posterUrl?, mediaMime?, mediaWidth?, mediaHeight?, navFeedId?, createTx }`. The server re-reads the pool on-chain and checks the creator and the launch transaction before recording anything. |
| `GET pools` | The registry. |
| `POST metadata` | Pins token metadata JSON to IPFS; the token's `tokenURI` points at it forever. |
| `POST upload` | Multipart media upload to IPFS. Video gets a poster frame. |

`Coin` fields that differ from the Solana-era API: `quote: { address, symbol,
decimals, native }`, `launchpad` (was `config`), `pair` (was `graduatedPool`,
and now known from launch), `curve.complete` (new: filled but not yet
graduated), `Activity.txHash` (was `signature`). `Holder.isTokenAccount` is gone:
EVM balances belong to wallets.

## Social

| Route | Body / query |
|---|---|
| `GET/POST comments` | `?coin={token}` / `{ token, wallet, body, side?, txHash? }` |
| `GET/POST likes` | `?coins=a,b&viewer=` / `{ token, wallet, liked }` |
| `GET/POST follow` | `?wallet=&viewer=` / `{ follower, target, following }` |
| `GET/POST posts` | `{ author, body, token?, parentId?, mediaUrl?, mediaMime? }` |
| `GET posts/{id}` | A post, its replies and its coin. |
| `GET saved` | `?wallet=&token=` |
| `GET/POST watchlist` | `{ wallet, token, alertPrice? }` |
| `GET/POST/PATCH/DELETE plans` | `{ wallet, token, amount, cadence, target? }`; `PATCH { id, contributed, txHash }` |
| `GET/POST profiles` | `?wallets=` / `{ wallet, name, issuedAt, signature }` — `signature` is an EIP-191 `personal_sign` of `nameMessage(wallet, name, issuedAt)` |
| `GET feed` | `?limit&following=` |
| `GET leaderboard` | `?limit` |
| `GET portfolio/{wallet}` | Holdings, cost basis and P&L. |
| `POST faucet` | `{ wallet }` → `{ hash, amount, symbol }` — testnet only; sends MON from the server's faucet key |
| `GET tessera` | Pre-IPO marks from Tessera and the Juno markets tracking them. |
