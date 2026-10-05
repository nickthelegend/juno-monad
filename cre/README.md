# Juno on Chainlink CRE: `juno-nav`

Juno's tracker coins (the `tight-nav` curve preset) each stand for a fixed
amount of an underlying. That is a share of a listed stock (priced by Pyth),
or a pre-IPO company as Tessera marks it. Juno's server shows how far each
curve sits from its NAV. **`juno-nav` makes the same comparison as a Chainlink
CRE workflow and writes it on chain.** Anyone on Monad can then read a coin's
NAV and premium without trusting Juno's server.

```
cron ─┬─ HTTP (consensus: median mark, identical id) ── Tessera public marks
      ├─ EVM read (Monad, last finalized block) ─────── Pyth on Monad: MON/USD, listed underlyings
      ├─ EVM read ───────────────────────────────────── Chainlink USDC/USD data feed on Monad
      ├─ EVM read ───────────────────────────────────── JunoLaunchpad.getPool: Q96 curve price, quote, graduated?
      ├─ integer maths (nav.ts): implied USD per unit, premium in bps, band check
      └─ report + writeReport ──────────────────────── JunoNavOracle.onReport (via KeystoneForwarder)
```

| Part | File |
|---|---|
| Workflow | `juno-nav/workflow.ts` (handler), `juno-nav/nav.ts` (integer maths, report encoding), `juno-nav/abis.ts` |
| Tests (SDK test runtime, capability mocks) | `juno-nav/workflow.test.ts`, run with `bun test` |
| Receiver | `contracts/src/cre/JunoNavOracle.sol` on Chainlink's `ReceiverTemplate` (`contracts/src/cre/vendor/`) |
| Receiver tests | `contracts/test/cre/JunoNavOracle.t.sol` (9 tests, including a fuzz test) |
| Deploy the receiver | `contracts/script/DeployNavOracle.s.sol` |
| Read in the app | `lib/juno/nav-oracle.ts` (`JUNO_NAV_ORACLE`); the coin page's reference card shows the attestation |
| Fork run without the CLI | `juno-nav/fork-attest.ts` |

## What the receiver guarantees

- Only the forwarder can call `onReport` (`ReceiverTemplate`). It can be
  pinned to one workflow id and owner after deployment.
- Each report carries the DON's observation time. An older or repeated report
  reverts (`StaleReport`), so a replayed report cannot roll a NAV back.
- A zero NAV or an empty report reverts. `withinBand` is computed on chain
  from the premium and the preset's band.

## Run it

```bash
cd cre/juno-nav && bun install          # also runs cre-setup (the Javy WASM plugin)
bun test                                # 7 tests, no network
bunx cre-compile main.ts dist/juno-nav.wasm
```

Simulation needs a CRE account (`cre login`, done in a browser by the
owner). From `cre/`:

```bash
cre login
# A local fork of Monad testnet on :8555 (anvil --fork-url https://testnet-rpc.monad.xyz
#   --chain-id 10143 --port 8555 --prune-history 300), JunoNavOracle deployed there with
#   FORWARDER=0xB9F79d863261869B234c481D1f9A7af84AeAd192 and set as `receiver` in
#   juno-nav/config.local-fork.json, and a funded fork key as CRE_ETH_PRIVATE_KEY in cre/.env:
cre workflow simulate juno-nav --target local-fork --non-interactive --trigger-index 0 --broadcast
# Monad testnet (once JunoNavOracle is deployed there and config.staging.json names it and the trackers):
cre workflow simulate juno-nav --target staging-settings --non-interactive --trigger-index 0
```

## Proof so far (6 Oct 2026, local fork of Monad testnet)

- `bun test`: 7 of 7 pass. They cover the integer maths against Juno's float
  version, and a full cron run through the SDK's test runtime. That run uses
  mocks for Pyth on Monad, Chainlink's USDC/USD feed, Tessera over HTTP and the
  launchpad. It decodes the exact report bytes the receiver gets: a curve
  coin in MON, one in USDC, one marked by Tessera, a graduated coin skipped,
  and an unreadable reference skipped.
- `cre-compile`: builds `juno-nav.wasm` (2.7 MB), passing the SDK's
  determinism and runtime checks.
- On the fork: a `tight-nav` SpaceX tracker launched on Juno's real testnet
  launchpad, and `JunoNavOracle` was deployed with the MockKeystoneForwarder.
  `fork-attest.ts` then ran the workflow's maths and encoder on live readings
  (Tessera's $423 mark; Pyth MON/USD and the curve on the fork). It delivered
  the report through the MockKeystoneForwarder's `report(...)`, the path
  `simulate --broadcast` uses. `onReport` succeeded and `navOf` returned NAV
  $423, premium +91 bps, inside the band. The coin page then showed
  "Attested on Monad by Chainlink CRE …".
- Not run: `cre workflow simulate` itself, which needs `cre login`.

On a fork, Juno's server reads Pyth from live testnet, because a fork's copy
of Pyth stops updating. The workflow reads the fork's frozen copy, so on the
fork their premiums differ by the MON/USD drift since the fork (1.3% in this
run). On testnet both read the same contract.
