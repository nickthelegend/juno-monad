# How Juno uses Perpl: perps, a risk view and a bot, beside the posts

*Juno · Monad Metropolis, Track 01 · live at https://juno-monad-app.vercel.app (Monad testnet)*

Juno is a social feed where every post is a market. A photo or a reel launches its own coin on a bonding curve on
Monad in one transaction. Fans buy it straight from the feed, and the creator earns the trading fees. When a curve
fills, the coin graduates into its own Kuru order book (or a Uniswap v2 pair, if the creator chose that at
launch).

## The problem Perpl solves: a trading app needs more than spot

Juno's coins are spot assets, and Kuru is spot only. A trading app also needs leveraged longs and shorts on the
majors, from the same wallet, without sending the user elsewhere. On Monad that means Perpl, an on-chain perps order book for BTC, ETH,
SOL, MON and others, with isolated margin and AUSD collateral.

Juno uses Perpl in three places:
1. a **Perps** tab in the Trade screen: live markets, an account, open and close;
2. a **Risk** view built on Perpl's public API;
3. a **bot** (`npm run juno:perpl-bot`) for funding carry and guarding positions.

## How it works

### 1. Market data from Perpl's API, positions from its contract

[`lib/juno/perpl.ts`](../lib/juno/perpl.ts) reads `GET /v1/pub/context` for every market's mark, oracle,
funding, open interest, taker fee and leverage. Size and price decimals come from the contract's
`getPerpetualInfoV2`. The account and its positions come from the chain.

### 2. Every order is an immediate-or-cancel `execOrder`

The server builds it and the user's wallet signs it. An open or close is one `execOrder` with a worst price:

```ts
functionName: "execOrder",
args: [
  {
    // …
    postOnly: false,
    fillOrKill: false,
    // A market order with a worst price: fill what the book has inside
    // it, never rest.
    immediateOrCancel: true,
    maxMatches: 100n,
    leverageHdths: BigInt(Math.round(leverage * 100)),
```

A close is the matching reduce-only order type for the whole position. A deposit is an AUSD approval, if the
allowance is short, followed by `createAccount` for a new account or `depositCollateral` for an existing one.

### 3. The Risk view

`perpMarketRisk` reads each market's last day of funding payments and its hourly candles from Perpl's API. It
then computes funding now and annualised, what the last day cost a $1,000 long, the premium to the oracle,
realised volatility and the 24h range. For each open position, `positionRisk` adds leverage on equity, distance
to liquidation, margin against maintenance, funding per day and the P&L after a 10% adverse move.
[`Perps.tsx`](../juno-expo/components/Perps.tsx) shows all of this under Perps → Risk and refreshes it every
15 seconds.

### 4. The bot

[`lib/juno/perpl-bot.ts`](../lib/juno/perpl-bot.ts) holds the bot's decisions as one pure function, `decide`,
covered by 10 unit tests. [`scripts/perpl-bot.ts`](../scripts/perpl-bot.ts) observes the market and account,
calls `decide`, and signs only what comes back, using the same `perpOpenCall` and `perpCloseCall` the app uses.
Exits always come before entries:

```ts
if (input.halted) return [{ kind: "hold", reason: "halted: the kill switch is on" }];
// …
// Guard and carry exits first: what is already at risk comes before anything new.
for (const position of input.positions) {
```

It opens on the side funding pays once annualised funding passes the entry threshold, and closes when funding
fades or turns. It guards every position on the account, including ones opened in the app, with a stop-loss, a
take-profit and a liquidation buffer. Limits: collateral per trade, positions, total notional, a daily loss
limit, a kill-switch file, and no chain 143 without `--mainnet`.
Details are in [PERPL-BOT.md](PERPL-BOT.md).

## Engineering notes

- **Size for the fee, not just the leverage.** Sizing an order at exactly collateral × leverage left no room for
  slippage or the taker fee, and Perpl refused to settle it. `perpOpenCall` now sizes to
  `collateral × leverage / (1 + slippage + leverage × fee)`.
- **0 is not "no limit".** Perpl's price field must sit in a band, `[basePrice + 1, basePrice + 2^24 − 1]`.
  Buys round the limit up and sells round it down, then both are clamped into that band.
- **Stale marks.** Perpl refuses to open or grow a position against a mark older than its maximum age. Juno checks
  the mark's timestamp first and says "new positions are paused. Closing still works", so the transaction is not
  sent only to revert.
- **Rate limits.** `perplJson` retries a 429 or 5xx after `Retry-After`, or after 1, 2 and then 4 seconds. A bot's
  tick or the Risk view's first load is a burst of reads, and one refusal should not lose the whole read. The
  bot reads funding and candle history only for the markets it watches.
- **An IOC can fill nothing.** The bot counts a position as its own only once the chain shows it.

## The value it brought

- **Spot and perps in one wallet.** A person who buys a post's coin can hedge or trade BTC in the same app, with
  the same signing flow and the same receipt.
- **Analytics on real data.** The Risk view turns Perpl's funding and candle data into what a position costs per
  day and how far it is from liquidation.
- **Automation on Perpl's API.** The bot runs a real strategy with limits on it.

## Live proof (Monad testnet)

These were sent on 13 Oct from one fresh wallet through Juno's hosted API, the same build, sign and submit path
the app uses. The margin was AUSD from Agora's faucet.

- Perpl account opened with a deposit:
  [0x7889568e…1564](https://testnet.monadvision.com/tx/0x7889568e2bb65cd1b0ac01b6338bb8d6407c95c254165a61573e037e38cc1564)
- A 2x BTC long, 47 lots at 83,372.7:
  [0x3f81ae5a…864b](https://testnet.monadvision.com/tx/0x3f81ae5afaf036f4b38b1e94f4b9bccc10fad402db8b735afa613088b011864b)
- The long closed:
  [0x429d63aa…a890](https://testnet.monadvision.com/tx/0x429d63aac297846255bbb09d3751de8943afa5e094a3171dbafcc2f5c7cca890)

On 5 Oct the same round trip passed in the hosted app's UI against Perpl's live testnet book: an account with
150 AUSD, a 2x BTC long filled at $85,937.80, then close and withdraw. The Risk view showed the open position's
distance to liquidation and margin health ([E2E-HOSTED.md](E2E-HOSTED.md)).

## Honest limits

- **The bot has not run on live testnet.** It was tested on an anvil fork of Monad testnet, which runs Perpl's
  real contracts with live marks copied in. On the fork it deposited, opened a real BTC short through
  `execOrder`, closed it, and held when the kill switch was on. A testnet run needs MON and AUSD on the bot's key.
  The app's open and close above are live testnet transactions.
- The fork proof used test thresholds (enter at 10%, exit under 20%) to force an open and a close in two ticks;
  the defaults are 30% and 10%.
- Positions are market orders only. The app does not place resting limit orders on Perpl.
