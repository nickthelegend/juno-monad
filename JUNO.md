# Juno

**A social app where every post is a live market.**

Publishing a post or a reel launches a token for it on Monad, sold on a
sixteen-range bonding curve by Juno's own launchpad contract. People buy into
the content itself as they scroll. The creator earns trading fees on their own
work instead of ad revenue. When the curve fills, its reserves graduate — into
a Uniswap v2 pair, or, if the creator chose it at launch, into the coin's own
Kuru order-book market — with the liquidity locked for good, and it becomes a
market that outlives the app.

There are two surfaces. **`juno-expo/`** is the mobile app and the one to look
at. The **Next.js server** at the repo root is the API the phone talks to.

---

## What is real, and what is not

This section is deliberately first.

### Built and tested

| | |
|---|---|
| **The launchpad** | `JunoLaunchpad.sol`: sixteen-range concentrated-liquidity curves, exponential fee decay, creator and protocol fee accrual, partial fills at the top, permissionless graduation. Foundry tests, including fuzzed invariants: a buy followed by a full sell never profits; split buys never beat one buy; the contract always holds at least the reserves plus every fee it owes. |
| **The token** | `JunoToken.sol`: fixed one-billion supply, EIP-2612 permit, `tokenURI` pointing at pinned metadata, transfers into its AMM pair locked until graduation, and no approval needed to sell to its own launchpad. |
| **Graduation** | `UniswapV2Graduator.sol`: fixes the pair's CREATE2 address at launch and locks the token against it, deploys the pair only at graduation, seeds it with the curve's reserves and mints the LP to the dead address. Survives a pair someone has donated to and `sync`ed. On testnet, where Uniswap has no official v2, the deploy script deploys the unmodified v2-core factory. |
| **Curve builder ↔ contract parity** | `lib/juno/curves.ts` builds every curve the app launches; `lib/juno/curve-math.ts` is `CurveMath.sol` in bigint. A generated fixture launches every preset on-chain in Foundry and checks the contract's supply split and threshold against the TypeScript figures exactly. |
| **Server-built, device-signed transactions** | EIP-1559 requests with nonces and estimated gas; the phone signs with a key in its secure store; the server broadcasts, waits for the receipt, and records what it did. |
| **Trade history** | From the launchpad's `Trade` events: recorded from receipts as trades land, a single log cursor for everything else, and an Envio HyperIndex indexer for full history. |
| **Oracles** | MON/USD from Pyth's contract on Monad, no key. Equity marks from the same contract, labelled with their real age, and fresh from Hermes when a key is configured. Pre-IPO marks from Tessera's API. |
| **Social layer** | Likes, comments, follows, posts and names persisted; a name is claimed with an EIP-191 signature. |
| **The Kuru venue** | `KuruGraduator.sol`: a creator can choose Kuru at launch. The token is locked against Kuru's MarginAccount until graduation; graduation opens a Kuru market for it against MON, seeds the market's AMM vault at the curve's final price and burns the vault shares. The app then quotes (Kuru's free `eth_call` path) and trades the coin on that market, and the indexer follows it there. Six fork tests run against Kuru's live testnet contracts; the whole lifecycle was run through the API and the web app on a fork. |
| **Privy (web)** | Sign in with email, Google or X; a Privy embedded wallet signs every server-built transaction behind Privy's own confirmation. An X account linked in Privy is shown on a profile only after the server verifies the session with the app secret. The provider and login modal are verified; a full login needs a real account and has not been run by us. |
| **Indexed holders, positions and rankings** | Envio indexes every token transfer and every fill (curve and Kuru), so holder lists include wallets that only received tokens by transfer, positions carry one average-cost basis across a graduation, and the leaderboard is built from the complete record. |

### Not built yet

| | Why / plan |
|---|---|
| **A deployment** | Nothing is deployed to Monad yet — this repository is the port. `contracts/deploy.sh testnet` deploys and verifies; the *On-chain proof* section below is where the lifecycle's transactions go. |
| **Embedded wallets on iOS/Android** | The native builds sign with a device key (`expo-secure-store`): real signing, not recoverable. Privy's React Native SDK needs an Expo development build; the web build already uses Privy. |
| **Holders without the indexer** | Without `ENVIO_GRAPHQL_URL`, holder lists are the live `balanceOf` of every wallet that has traded a coin, which misses wallets that only received tokens by transfer. |
| **Kuru on mainnet** | Kuru's mainnet Router lets only Kuru's own Safe create markets, so the Kuru venue exists on testnet only. |
| **Fresh equity marks without a key** | Pyth does not push equities to Monad. Without `PYTH_API_KEY` a stock tracker's mark is the last one posted on-chain, shown with its age and labelled stale. |
| **TestFlight / Play builds** | `eas.json` is ready; submitting needs Apple Developer and Play Console accounts. |

---

## The curve

A Juno curve is a start price and sixteen ranges above it. Inside one range the
curve is a Uniswap v3 position with constant liquidity `L`:

```
quote between √a and √b  =  L · (√b − √a)
base  between √a and √b  =  L · (√b − √a) / (√a · √b)
```

Prices are square roots in Q64.96 of the raw price, quote wei per base wei.
The liquidity in a range sets how much supply that stretch absorbs per unit of
price — **more liquidity, flatter curve** — so the sixteen weights are the
character of a launch:

| Preset | Weights | For |
|---|---|---|
| `content` | back-loaded `1.2^i` | a post or reel; cheap entry, steepens with attention |
| `thin-name` | **front-loaded** `0.82^i` | a newly tokenized low-float stock — deep book at the issue price so early size fills instead of gapping the print |
| `ipo-book` | deep at both ends, thin in the middle | book-building: absorb the open, discover price mid-curve, flatten near the target cap |
| `tight-nav` | uniform | an asset meant to track an underlying; behaves like a spread, not a launch |

### The solve

Given an opening and a graduation valuation, the builder places the sixteen
range boundaries geometrically between the two prices, then solves for the one
liquidity scale at which

```
supply sold on the curve  +  supply reserved for the AMM  =  99% of supply
```

where the AMM's share is the quote the curve raises, **priced at the curve's
top**. That clause is what makes graduation continuous: the pair opens at
exactly the price the curve finished on, so nobody can buy the last token on
the curve and sell it into the pair at a guaranteed profit. The last 1% is a
rounding buffer, burned at graduation.

This is the same solve Meteora's `buildCurveWithLiquidityWeights` performs for
its Dynamic Bonding Curve, which Juno used on Solana. On Monad the contract
enforces it: `launch` recomputes the supply the curve sells and the quote it
raises from the ranges themselves, and reverts if they do not fit.

### Rounding

Every rounding choice in `CurveMath.sol` favours the pool: amounts a trader pays
round up, amounts a trader receives round down. After every holder sells back,
the price rests a few wei *above* where it started, never below.

### Fees

Charged in the quote token on both sides. The launch fee decays exponentially
to a resting fee over sixty periods — `content` goes from 9% to 1% over ten
minutes — which blunts snipers without taxing the post's audience forever. A
protocol share (20% by default, fixed per pool at launch) goes to the protocol;
the rest accrues to the creator and is claimable any time.

### Graduation

When a buy reaches the top of the last range, the curve is **complete**: it
fills what it can, refunds the rest in the same transaction, and closes to
trading. Anyone may then call `graduate`, which moves the quote reserve and the
reserved base into the token's Uniswap v2 pair and mints the LP to the dead
address. A MON curve graduates into a WMON pair.

The pair's address is fixed at launch — a Uniswap v2 pair lives at a CREATE2
address derived from the factory, the two tokens and the pair's init code
hash — and the token refuses transfers into it until graduation. The pair is
only deployed when the curve graduates, so a launch costs about 2.06M gas
rather than 4.57M: most posts never fill, and they no longer pay for a pair
they will not use. Without that lock, anyone could seed the pair at a price of their
choosing before the curve's reserves arrive, and the migration's liquidity
would be minted against that ratio — donating the difference to whoever got
there first.

---

## Trade history on Monad

Monad's public RPC answers `eth_getLogs` over at most 100 blocks — thirty
seconds of chain. So trade history arrives three ways, cheapest first:

1. **The receipt.** Every trade made in the app is submitted by the server,
   which decodes its `Trade` event from the receipt and records it in Postgres
   on the spot. The chart moves the moment the transaction confirms.
2. **The log tail.** One cursor for the whole launchpad walks forward a few
   ranges per request (or per cron hit to `/api/juno/index`), catching trades
   made anywhere else. With a dedicated RPC, `JUNO_LOG_RANGE` widens each step.
3. **Envio.** `indexer/` is a HyperIndex project over every launchpad event.
   With `ENVIO_GRAPHQL_URL` set, history comes from there: complete from the
   launchpad's first block.

A history the tail has not caught up on is reported as partial, and the app
says so rather than presenting a prefix as the whole story.

---

## Monad specifics the code accounts for

- **Gas is charged on the limit, not on what is used.** Every step is estimated
  and given a 7.5% margin, Monad's own recommendation, instead of a round number.
- **The reserve balance.** A transaction that sends MON and leaves the account
  under 10 MON can revert if the account sent another transaction in the last
  three blocks. The app keeps a gas reserve on "Max", and the error is explained
  in a sentence if it happens.
- **Freshly funded accounts** cannot send until the funding transaction is
  three blocks old; the faucet waits for that before it answers.
- **Sub-second finality.** The server waits for the receipt before answering a
  submit — about a second — so the app shows a confirmed trade, not a pending one.

---

## On-chain proof (testnet)

*To be filled in after `contracts/deploy.sh testnet` and one full lifecycle —
launch, trade, fill, graduate, claim.*

| | |
|---|---|
| `JunoLaunchpad` | — |
| `UniswapV2Graduator` | — |
| `KuruGraduator` | — |
| A launch | — |
| A buy and a sell | — |
| The buy that completed a curve | — |
| Its graduation, and the resulting pair | — |
| A creator fee claim | — |
