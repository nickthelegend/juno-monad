# Monad-native: what Juno uses that a plain EVM chain doesn't have

Each item says **where it runs**:
- **live testnet read**: read from Monad testnet itself, now;
- **local fork**: real code on an anvil fork of Monad testnet;
- **awaiting testnet go**: needs a Monad testnet transaction, which this
  project holds until the owner funds it.

Fork timings are never presented as Monad's: the UI labels them. Numbers
below were measured on 7 Oct 2026 unless marked.

| # | Item | Status | Where it runs |
|---|---|---|---|
| 1 | Live commit-state strip (`monadNewHeads`) | **Built** | Live testnet read |
| 2 | Two-timer receipts (`eth_sendRawTransactionSync` + commit stream) | **Built** | Executed: local fork, labelled. Final: Monad testnet's live median on a fork; this trade's own once trades run on testnet |
| 3 | Transaction status (`txpool_statusByHash` / `ByAddress`) | **Built** | Testnet deployments; on a fork the endpoint says `supported: false` (anvil has no txpool methods) |
| 4 | Passkeys on chain (Mera + P256 precompile `0x0100`) | **Built** | Local fork (the precompile runs there too); live testnet `eth_call` checked |
| 5 | Native staking (precompile `0x1000`) | **Built (read)** | Live testnet read. Delegating: awaiting testnet go |
| 6 | Monad gas correctness (limit billing, reserve rule, size, layout) | **Built + documented** | App rules on any chain; billing shown per chain |
| 7 | Monad-native payments (x402 facilitator / MPP) | **Not built** | See below: Juno has no pay-per-request API, and settlement is a testnet transaction |
| 8 | Canonical contracts, verification, links | **Built** | Testnet deployment (Sourcify-verified), canonical WMON / USDC / Multicall3 |

## 1. Live commit-state strip

`monadNewHeads`, read from `wss://testnet-rpc.monad.xyz`. Every block shows up
as a chip that turns Proposed (grey) → Voted (blue) → Finalized (green) →
Verified (✓). The medians of each stage sit beside it, along with the
observed block time.
- **Measured:** voted 292–295 ms, final 558–578 ms, verified 1.5 s, blocks 296–300 ms.
- **Code:**
  - [`lib/juno/heartbeat.ts`](../lib/juno/heartbeat.ts) folds the stream. It
    drops competing proposals at a height once one finalizes, because Monad
    sends no abandonment.
  - [`app/api/juno/heartbeat`](../app/api/juno/heartbeat/route.ts) serves it.
  - [`Heartbeat.tsx`](../juno-expo/components/Heartbeat.tsx) draws the strip on
    the landing.
- **Behaviour:** the socket opens when someone looks and closes after a
  minute with nobody looking. It is always Monad's own network, and the
  strip says when Juno's trades run on a fork.
- **Tests:**
  - [`juno-heartbeat.test.ts`](../tests/unit/juno-heartbeat.test.ts) (5);
  - `tests/e2e/wave.mjs after heartbeat`: connected, ~300 ms blocks, final
    after voted.
- **Screenshot:** [`heartbeat-after-mobile.png`](screens/wave/heartbeat-after-mobile.png).

## 2. Two-timer receipts

- **Executed:** the milliseconds from broadcast to a receipt in hand, timed
  by the server around `eth_sendRawTransactionSync` (EIP-7966), one round
  trip.
- **Final:** on Monad, this trade's own Proposed → Finalized from the commit
  stream. On a fork, which has no consensus to time, it shows Monad
  testnet's live finality median and says it is the network's.
- **Also on the receipt:**
  - signing time on the device;
  - the block;
  - what the transaction paid. Monad bills the gas limit; a fork bills gas
    used, and the receipt says which.
  - The same gas at Ethereum mainnet's live gas price, with no line if that
    read fails.
- **Code:** [`SpeedReceipt.tsx`](../juno-expo/components/SpeedReceipt.tsx),
  [`lib/juno/tx-cost.ts`](../lib/juno/tx-cost.ts),
  [`app/api/juno/tx/cost`](../app/api/juno/tx/cost/route.ts).
- **Tests:** [`juno-tx-cost.test.ts`](../tests/unit/juno-tx-cost.test.ts) (7).
  The e2e checks that the ms shown equals the server's `confirmedInMs` and
  that the fee matches the receipt.
- **Screenshot:** [`receipt-after-mobile.png`](screens/wave/receipt-after-mobile.png).

## 3. Transaction status

On Monad, `eth_getTransactionByHash` shows nothing until a transaction is in
a block. When a send is accepted but not yet confirmed, the buy sheet asks
`txpool_statusByHash` every second and says what the node says: pending,
dropped with its reason, or included.
- **Code:** `GET /api/juno/tx/status?hash=` or `?address=`
  ([route](../app/api/juno/tx/status/route.ts),
  [`lib/juno/txpool.ts`](../lib/juno/txpool.ts),
  [`TxpoolWatch.tsx`](../juno-expo/components/TxpoolWatch.tsx)).
- **Testnet's real answers** ("Unknown tx hash", "No transactions") are in
  [`juno-txpool.test.ts`](../tests/unit/juno-txpool.test.ts).
- **On the fork:** the endpoint answers `supported: false`, and the e2e
  checks it.

## 4. Passkeys on chain

A Mera passkey account can prove it is a passkey:
1. The passkey signs a server challenge (a WebAuthn assertion).
2. The wallet signs a message naming the passkey's public key.
3. The server sends the assertion to Monad's P256 precompile `0x0100`
   (EIP-7951) with `eth_call`, the same check a contract makes.
4. The profile then shows "Passkey verified on Monad" ("(fork)" on a fork).

- **Testnet:** the precompile returned `0x…01` for a valid signature and
  empty for a tampered one.
- **Code:**
  - [`lib/juno/passkey-verify.ts`](../lib/juno/passkey-verify.ts),
    [`passkey-link.ts`](../lib/juno/passkey-link.ts),
    [`app/api/juno/passkey`](../app/api/juno/passkey/route.ts);
  - [`PasskeyOnChain.tsx`](../juno-expo/components/PasskeyOnChain.tsx);
  - [`mera-client.ts`](../juno-expo/lib/mera-client.ts), Mera's browser client
    plus capture of the passkey's public key.
- **Tests:**
  - [`juno-passkey-verify.test.ts`](../tests/unit/juno-passkey-verify.test.ts) (5);
  - `wave.mjs after passkey`, with Chrome's virtual authenticator.
- **Not yet:** the phone apps don't capture the key yet.
- **Screenshot:** [`passkey-after-mobile.png`](screens/wave/passkey-after-mobile.png).

## 5. Native staking

The Wallet tab reads the staking precompile `0x1000` on Monad testnet through
`@monad-crypto/viem`:
- the epoch, and when a stake change would take effect;
- the validator proposing now, with stake and commission (for example,
  epoch 1,381 and validator #196 with 11.00M MON staked);
- the consensus set's size (199);
- the address's delegations.

The precompile has no code on a fork, so it is always read from Monad.
Delegating is a transaction: the button says it works on Monad only, and it
opens with the deployment's testnet transactions (**awaiting testnet go**).
- **Code:** [`lib/juno/staking.ts`](../lib/juno/staking.ts),
  [`StakingCard.tsx`](../juno-expo/components/StakingCard.tsx).
- **Tests:** [`juno-staking.test.ts`](../tests/unit/juno-staking.test.ts),
  which decodes testnet's real validator tuple.
- **Screenshot:** [`staking-after-mobile.png`](screens/wave/staking-after-mobile.png).

## 6. Monad gas correctness

- **Charged on the gas limit.** Every transaction Juno builds sets an
  explicit limit: the estimate plus a 7.5% margin, not a blanket multiplier
  ([`lib/juno/tx.ts`](../lib/juno/tx.ts)).
  - A transaction whose simulation reverts is refused with the reason, so a
    wallet never falls back to a 30M-gas limit that Monad would bill in
    full.
  - A later step that can't be estimated until an earlier one lands (a buy
    after its approval) gets a fixed, bounded limit.
  - The receipt shows what was billed, and on what rule.
- **Reserve balance (10 MON).** Under 10 MON, a wallet may spend below its
  reserve once every 3 blocks (about 0.9 s); a 7702-delegated one may not end
  below it at all. A second dip inside the window would be included and
  revert.
  - [`juno-expo/lib/reserve.ts`](../juno-expo/lib/reserve.ts) encodes the rule
    ([tests](../tests/unit/juno-expo-reserve.test.ts), 5).
  - The buy sheet says when a buy relies on the exception, and holds a
    second one for the window ("Wait a moment") instead of letting it revert.
  - Juno's faucet never pays out below its own 10 MON reserve.
- **Contract size.** `JunoLaunchpad` is 19.9 KB, well under Monad's 128 KB.
  Nothing here needed the larger limit.
- **Storage for MIP-8 and parallel execution.**
  - Each pool's state is one struct under one mapping key (`_pools[token]`),
    so a trade touches one contiguous region: few cold pages, and pools
    don't conflict with each other.
  - One shared slot remains: `protocolFees[quote]` is written by every trade
    on every MON pool, so trades in the same block on different coins
    re-execute against each other under load. A per-pool accrual would
    remove the conflict. It isn't changed here, because it means
    redeploying the verified contracts. It is listed for the next contract
    release.
- **Block time.** The chain definitions say 300 ms blocks (viem 2.57 still
  says 400 ms) ([`lib/juno/network.ts`](../lib/juno/network.ts),
  [test](../tests/unit/juno-network.test.ts)).

## 7. Monad-native payments: not built, and why

x402 (Monad's facilitator at `x402-facilitator.molandak.org`) and MPP
(`@monad-crypto/mpp`) are for **paying for HTTP requests**: an API that
charges per call. Juno's money moves are on-chain trades that already settle
in MON or USDC directly. Juno sells no API access, so there is no request to
put a price on without inventing a product.

The natural fit would be paid market data for agents (the `mm juno ask`
agent). Its settlement is a USDC transfer on Monad testnet made by the
facilitator, which waits for the testnet go like every other testnet
transaction. Recorded as **not applicable today**.

## 8. Canonical contracts, verification and links

Juno uses Monad's canonical testnet contracts rather than its own copies:
- WMON (`0xFb8b…C541`) for the swap router;
- Circle's USDC (`0x534b…43A3`) as the USDC quote;
- Multicall3 (`0xcA11…CA11`) for batched reads.

[`juno-canonical.test.ts`](../tests/unit/juno-canonical.test.ts) pins all
three. Every Juno contract is verified on MonadVision through Sourcify
([`contracts/deployments/10143.json`](../contracts/deployments/10143.json)).
Every hash and address in the app links to MonadVision on testnet; on a fork
they show as plain text, never as dead links.

Not used, with reasons:
- **Permit2:** USDC buys approve once, directly. Permit2 would save one
  signature, but needs the launchpad and router to accept it, which means a
  contract release.
- **EntryPoint (4337):** Juno's sponsored path is Privy's native gas
  sponsorship; there is no smart account.
- **CreateX:** the testnet contracts were deployed and verified before this
  wave; deterministic addresses are for the next release.
