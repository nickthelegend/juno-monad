# Juno's Perpl bot

A trading bot for [Perpl](https://perpl.xyz), the on-chain perps exchange on
Monad. Built for Perpl's "Best use of the API" bounty, which asks for a
production-ready trading bot or automation. It does two jobs, alone or together:

- **Funding carry.** Perpl pays funding every ~43 minutes, and when one side
  pays the other a lot, holding the side that gets paid earns a yield. The bot
  opens a position on the paid side once a market's annualised funding passes
  `entryAnnualized`, and closes it when funding falls under `exitAnnualized` or
  turns against it.
- **Guard.** For every open position on the account (the bot's own or one a
  person opened in Juno's Perps tab), it closes on a stop-loss, on a
  take-profit, or when the mark comes within `liquidationBuffer` of the
  liquidation price.

| Part | File |
|---|---|
| Decisions: pure, every rule unit-tested | `lib/juno/perpl-bot.ts`, `tests/unit/juno-perpl-bot.test.ts` |
| Runner: observes, decides, signs | `scripts/perpl-bot.ts` |
| Perpl API client (context, funding history, candles; 429 retry) and order building | `lib/juno/perpl.ts` |
| Example config | `scripts/perpl-bot.example.json` |

## What it reads from Perpl

Each tick reads:

- `GET /v1/pub/context`: marks, funding rate and interval, open interest,
  maximum leverage and taker fee per market.
- `GET /v1/market-data/:id/funding/:from-:to`: the last day's funding
  payments, annualised, for the markets it watches.
- `GET /v1/market-data/:id/candles/3600/:from-:to`: hourly candles, used for
  realised volatility. It opens nothing in a market more volatile than
  `maxVolatility`.
- On chain: the account, its positions (entry, collateral, P&L, liquidation
  price), and each market's oracle age. It skips a market whose mark Perpl
  would refuse as stale.

It reads funding and candles only for the markets in `markets`, plus any
market it holds a position in. A 429 or 5xx is retried after `Retry-After`,
or else after 1, 2 and 4 seconds.

## How it trades

Opens and closes are Perpl `execOrder` calls: immediate-or-cancel at a worst
price 1% from the mark, built by the same server code that Juno's Perps tab
uses, and signed with the bot's own key. A position becomes the bot's only
once the chain shows it, since an IOC order can fill nothing. Carry exits
apply only to positions the bot opened. The guard applies to every position.

## Limits

| Limit | Default |
|---|---|
| Collateral per trade | 25 AUSD |
| Leverage | 2x, never above the market's maximum |
| Positions held | 2 |
| Total notional | $200 |
| Stop-loss / take-profit | −25% / +50% of the position's collateral |
| Liquidation buffer | close within 15% of liquidation |
| Daily loss limit | 20 AUSD realised: after that it opens nothing new that day |
| Kill switch | the file `.juno/perpl-bot.halt` exists: it does nothing and says so |

Exits are checked before entries. It never closes and reopens a market in
the same tick. It refuses chain 143 (Monad mainnet, real money) unless
started with `--mainnet`.

## Running it

```bash
cp scripts/perpl-bot.example.json .juno/perpl-bot-config.json
npm run juno:perpl-bot -- status --config .juno/perpl-bot-config.json
npm run juno:perpl-bot -- deposit 150
npm run juno:perpl-bot -- run --dry-run --once --config .juno/perpl-bot-config.json
npm run juno:perpl-bot -- run --config .juno/perpl-bot-config.json --interval 30
```

The key comes from `PERPL_BOT_PRIVATE_KEY`, or else `.juno/perpl-bot.key`
(created on first run, gitignored). The bot's wallet needs testnet MON for
gas and AUSD for collateral. Juno's Perps tab has Agora's AUSD faucet. Its
state (positions it opened, realised loss by day) is kept in
`.juno/perpl-bot-state.json` and survives restarts. Ctrl-C finishes the
current tick before stopping. Logs are JSON lines, one per event (`tick`,
`tx`, `opened`, `unfilled`, `closed`, `error`).

## Proof

Run on a local anvil fork of Monad testnet (Perpl's real contracts and
order book, with the live testnet marks copied in), 5–6 Oct 2026:

```
{"event":"tick","free":199.96,"positions":[],"actions":["open BTC short: funding 12.2% a year ≥ 10.0%: short is paid"]}
{"event":"tx","label":"Opening a 2x short on BTC","hash":"0xa429fa43…","block":68487571}
{"event":"opened","symbol":"BTC","side":"short","mark":85683.3,"reason":"funding 12.2% a year ≥ 10.0%: short is paid"}
{"event":"tick","free":175.52,"positions":[{"symbol":"BTC","side":"short","pnl":0.00912,"liq":0.46,"bot":true}],"actions":["close BTC: funding faded to 12.2% a year, under 20.0%"]}
{"event":"tx","label":"Closing your BTC short","hash":"0x31d571ba…","block":68487573}
{"event":"closed","symbol":"BTC","pnl":0.00912,"reason":"funding faded to 12.2% a year, under 20.0%"}
```

The test config used a low entry (10%) and a high exit (20%) so that one
open and one close happened within two ticks. Earlier fork runs covered the
deposit (account 845), the kill switch (`hold: halted: the kill switch is
on`) and the daily-loss bookkeeping. Juno's Perps tab traded on Perpl's
**real** testnet book on 5 Oct (`docs/E2E-HOSTED.md`, G5). The bot uses the
same order path, so a run on real testnet needs only MON and AUSD in its
wallet.
