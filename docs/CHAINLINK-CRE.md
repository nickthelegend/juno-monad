# How Juno uses Chainlink CRE: a tracker's NAV that no single server vouches for

*Juno · Monad Metropolis, Track 01 · live at https://juno-monad-app.vercel.app (Monad testnet)*

Juno is a social feed where every post is a market. A photo or a reel launches its own coin on a bonding curve on
Monad in one transaction. Fans buy it straight from the feed, and the creator earns the trading fees. When a curve
fills, the coin graduates into its own Kuru order book (or a Uniswap v2 pair, if the creator chose that at
launch).

## The problem CRE solves: "is this tracker priced fairly?"

Most Juno coins are posts. Some are **trackers**, launched on the `tight-nav` curve preset. Each tracker stands for
a fixed amount of an underlying: a share of a listed stock, or a pre-IPO company as Tessera marks it (OpenAI,
Kalshi, SpaceX). A tracker is only useful if a buyer can see how far its curve price sits from the value it
tracks: its premium or discount to NAV.

Juno's server already computes that number, but a number from Juno's server is only as good as Juno's honesty.
A Chainlink CRE workflow makes the same comparison (the underlying's price agreed across nodes, the curve read
from the chain) and **writes it on Monad**, where any app or contract can read it.

## How it works

The workflow is [`cre/juno-nav/`](../cre/juno-nav/), written with Chainlink's TypeScript CRE SDK.
[`main.ts`](../cre/juno-nav/main.ts) starts a `Runner`, and [`workflow.ts`](../cre/juno-nav/workflow.ts)
registers one cron handler.

### 1. Tessera over HTTP, with consensus

Every node reads Tessera's public marks. The DON keeps the median mark and requires every node to report the same
token id:

```ts
const tesseraAggregation = ConsensusAggregationByFields<TesseraReading>({ id: identical, markPrice: median });
```

### 2. EVM reads on Monad, at the last finalized block

For each tracker in the config, the workflow reads:
- MON/USD (and any listed underlying) from Pyth's contract on Monad;
- the coin's pool from `JunoLaunchpad.getPool`: its Q96 curve price, its quote token, and whether it has graduated;
- Chainlink's USDC/USD Data Feed, for coins quoted in USDC.

A graduated coin is skipped, because its price now lives on its pair or book. A reference that can't be read
skips only that coin.

### 3. Integer maths, then one signed report

[`nav.ts`](../cre/juno-nav/nav.ts) does all the arithmetic in 18-decimal bigints, so every node produces the same
bytes:

```ts
/** (implied − nav) / nav in basis points, rounded toward zero. */
export function premiumBps(implied: bigint, nav: bigint): bigint {
  if (nav <= 0n) throw new Error("NAV must be positive");
  return ((implied - nav) * 10_000n) / nav;
}
```

The handler encodes `(observedAt, NavPoint[])`, asks the runtime for a signed report, and writes it to the
receiver:

```ts
const report = runtime.report(prepareReportRequest(encodeReport(observedAt, points))).result();
const reply = evmClient(runtime.config)
  .writeReport(runtime, {
    receiver: runtime.config.receiver,
    report,
    gasConfig: { gasLimit: runtime.config.gasLimit },
  })
  .result();
```

### 4. The receiver on Monad

[`JunoNavOracle.sol`](../contracts/src/cre/JunoNavOracle.sol) is built on Chainlink's `ReceiverTemplate`, so only
the configured forwarder can deliver a report. It keeps the latest attestation per coin, works out `withinBand` on
chain, and refuses older or repeated reports:

```solidity
if (points.length == 0) revert EmptyReport();
if (observedAt <= lastObservedAt) revert StaleReport(observedAt, lastObservedAt);
```

### 5. The app reads it back

[`lib/juno/nav-oracle.ts`](../lib/juno/nav-oracle.ts) calls `navOf(token)` on the oracle and caches the result
for 30 seconds. The coin page shows "Attested on Monad by Chainlink CRE" next to Juno's own NAV line, so a buyer
can compare the two.

## Engineering notes

- **No floats on the wire.** Juno's server computes NAV in floats for display. The workflow repeats the same maths
  in bigints, and a unit test checks the two against each other. Tessera's float mark is rounded to a millionth
  of a dollar before scaling.
- **The DON's time, not a node's.** `observedAt` comes from `runtime.now()`, the time the DON agreed on, and the
  receiver uses it to reject replays. Tessera's API has no timestamp, so a Tessera NAV is stamped with the time the
  DON read it.
- **Pyth on a fork goes stale.** On an anvil fork, the copy of Pyth stops updating, while Juno's server reads live
  testnet Pyth. In the 6 Oct fork run, the two premiums differed by the MON/USD drift since the fork (1.3%). On
  testnet both read the same contract.
- **Forwarder choice.** The deploy script defaults to Monad testnet's production KeystoneForwarder. For
  `simulate --broadcast` the oracle has to trust the MockKeystoneForwarder (`0xB9F79d86…d192`) instead. The
  testnet oracle reports that address from `getForwarderAddress()`.
- **Tested in Chainlink's runtime.** There are 7 workflow tests on the SDK's test runtime, with capabilities
  mocked. One covers a coin in MON, one in USDC, one marked by Tessera, a graduated coin and an unreadable
  reference. There are also 9 Foundry tests for the receiver, including a fuzz test. `cre-compile` builds the
  workflow to WASM and passes the SDK's determinism checks.

## The value it brought

- **Trust moved off Juno's server.** A tracker's premium to NAV is now a value on Monad that a contract could act
  on, for example to pause buys outside the band. Nobody has to take Juno's word for it.
- **Orchestration in one place.** The workflow combines an off-chain API (Tessera, with consensus), two on-chain
  oracles (Pyth and a Chainlink Data Feed) and Juno's own contract state in a single run, and settles the result
  on chain.
- **On the product.** The attestation appears on the coin pages people trade from.

## Live proof (Monad testnet)

On 13 Oct, `cre workflow simulate juno-nav --target staging-settings --broadcast` ran with the CRE CLI against
Monad testnet. It read Tessera with consensus, Pyth on Monad and the launchpad. One report through the
MockKeystoneForwarder attested OPENAIX, KALSHIX and SPACEXX:
[0xc777646c…2b10](https://testnet.monadvision.com/tx/0xc777646ce8fee4d90e5da2fa2244b8ea84ddde8e40bb02b914f0e0ea0abb2b10)

- Oracle: `0x2DF370b26CaDBCf94Df3e6766B9f7D91Bf36DC9f`, Sourcify-verified. `reportCount()` returns 1.
- The hosted API serves the attestation. OPENAIX: NAV $812.79, premium −0.35%, inside its 2% band.

## Honest limits

- **Simulated, not deployed to a DON.** The workflow ran with `cre workflow simulate --broadcast`. The CLI runs
  it locally and delivers the report through Monad testnet's MockKeystoneForwarder. The transaction and the
  on-chain attestation are real, but no live Chainlink DON has signed a report, and the cron does not fire on its
  own. A real deployment needs the workflow deployed to a DON and the oracle repointed at the production
  forwarder.
- **One report so far.** Each NAV is a snapshot from 13 Oct until the next run.
- **The Data Feed path wasn't used in this report.** The workflow reads Chainlink's USDC/USD feed only for
  USDC-quoted coins. All three attested trackers are quoted in MON, so their USD conversion came from Pyth's
  MON/USD. The USDC path is covered by the workflow tests.
- The receiver is not yet pinned to one workflow id and owner, though `ReceiverTemplate` supports it.
