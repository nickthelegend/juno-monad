# Juno: what "deep, Monad-native" and "deep Envio" integration can mean

Research date: 2026-09-24. Scope: docs, GitHub, read-only probes against `https://testnet-rpc.monad.xyz` / `wss://testnet-rpc.monad.xyz` (no transactions sent; the only `eth_sendRawTransaction*` calls used malformed bytes or a chain-id-1 tx that cannot be included).

Legend: **[probed]** = verified live against Monad testnet today. **[docs]** = stated in official docs (URL given). **[code]** = read in the Juno repo. **[unverified]** = could not confirm; treat as a lead.

---

## 0. Top findings (read this first)

1. **`eth_sendRawTransactionSync` works on Monad testnet and viem already has it.** The method is implemented on the public RPC (it decodes and validates the tx rather than returning `-32601 Method not found`). viem 2.56.8 (Juno's version) exposes `client.sendRawTransactionSync({ serializedTransaction, timeout })` on both public and wallet clients. Juno's `lib/juno/tx.ts` still does `sendRawTransaction` + `waitForTransactionReceipt`. viem's `monadTestnet` chain has `blockTime: 400`, which gives a 500 ms receipt polling interval. **[probed][code]**
2. **The Monad WebSocket extensions are live and do what the docs say.** `monadNewHeads` and `monadLogs` carry `blockId` and `commitState` fields. The same block showed up as Proposed, then Voted, Finalized and Verified within about 1 s. Plain `newHeads`/`logs` emit once, at Proposed. These can drive a "live tape" for trades (see §2.3). **[probed]**
3. **One hot storage slot in the contract:** `_accrue()` does `protocolFees[p.quote] += protocol` on every trade. Every MON-quoted trade across *all* tokens writes the same slot, as does every launch (`tokens.push`). Monad's docs say that contention changes correctness nothing and is not repriced in gas. It only costs re-execution, which is cheap. The single-vault design also shares the launchpad's MON and USDC balance across all trades. Treat this as a design point to *explain* in the write-up, not a big throughput win. MIP-8 page storage is the measurable one: moving the 16-segment curve into the `Pool` struct should save about one cold page load (~8,000 gas) per trade, and Monad charges the gas *limit*. This is an estimate and needs measuring (§2.4). **[docs][code]**
4. **Reserve balance is a real UX edge for a trading app.** A user with less than 10 MON who fires two MON-quoted buys within about 1.2 s (k=3 blocks) can have the second one *included but reverted*, and it still pays gas. If Juno ever adds EIP-7702 (batching or sponsorship), delegated EOAs can never dip below 10 MON, so MON-quoted buys from small wallets would revert. **[docs]**
5. **P256VERIFY (0x0100) works on testnet.** A valid vector returned `1`, a tampered one returned empty, and gas was ~30.8k total for a bare call. CLZ also works: `clz(1)=255`, `clz(0)=256` via `eth_call` initcode. `dippedIntoReserve()` at 0x1001 answers `false` via `eth_call`. Staking precompile views answer (epoch 1303, 100+ validators). **[probed]**
6. **The Juno dev environment can't show any of this yet.** `.env.development.local` points `MONAD_RPC_URL` at `http://127.0.0.1:8545` (a local anvil fork), and local Foundry is **1.7.1**. Monad execution support (`--network monad`: gas-limit charging, Monad precompiles, MIP-8 pricing) needs **Foundry ≥ 1.8**. The configured launchpad address `0x43cA…A075` has **no code on real testnet**, `ENVIO_GRAPHQL_URL` is empty, and HyperSync can't index a local fork. For the "Monad Integration (20%)" criterion and the Envio bounty, this is the first thing to fix. **[code][probed]**
7. **Envio: the indexer is well-built, but the app barely reads it.** `lib/juno/envio.ts` exposes one query, `Trade` by token or trader, and the app only calls it by token (`swaps.ts`). The indexed `Position` (balance, cost basis, realized PnL), `Account`, `Pool.holderCount`, `CreatorClaim`, `Graduation` and `QuoteToken` totals are **never read**. The leaderboard and portfolio rebuild state from per-token trade lists, one GraphQL call per pool. Nothing is indexed after graduation: Uniswap v2 pair swaps are missing, so price and PnL freeze at graduation. There are no candle or time-series entities. The bounty asks that Envio "power real on-chain data driving a core feature", so this is the gap to close (§3.4). **[code]**
8. **The "not another memecoin bonding curve" resource page could not be found** in any public source. The public Metropolis page has no such text. It is most likely inside the logged-in platform (hackathon.monad.xyz: Rules or Tracks & Bounties). **[unverified]**

---

## 1. What Monad judges / devrel say they want

### Metropolis (public page) [docs]
Source: https://monad.xyz/developers/hackathons/metropolis
- Dates: build window 1 Sep to 13 Oct 2026, judging 14 to 27 Oct, winners announced 3 Nov.
- Four tracks at $30k each plus a $25k grand champion. Track 03, "Social, Attention & Culture", lists these example ideas: "A feed where curation is paid for by the people who benefit from it", "Markets on cultural outcomes rather than financial ones". Juno's `docs/METROPOLIS.md` already maps to these.
- Track 04 example: "Passkey-native accounts using P256 and WebAuthn, with no seed phrase". This is an explicit signal that P256 and passkeys are wanted.
- Sponsor bounties: "Best Use of Envio" $1,000 (plus "Free Envio Cloud hosting for winning teams", $5,000 pool), "Best Mera-Powered UX on Monad" $2,500, "Mera: One Passkey, Many Keys" $2,500, Kuru ×2 at $5k, Agora "Best Mobile Trading App" $10k, among others.
- Submission: "A working product with a public project profile: a demo, a short write-up, and link to the code." Also: "Judges need to be able to verify what you built during the six weeks."
- **No memecoin or bonding-curve warning appears on the public page.** I checked the full rendered HTML payload for "meme", "bonding", "launchpad", "pump" and "avoid".

### Judging rubric: secondary source, a participant repo quoting the logged-in Rules [unverified-official]
Source: https://github.com/precious-akpan/monad-metropolis-merchant-rails (README, "Judging criteria — now published verbatim (Rules §5.2)")
- All tracks, 20% each: **Product Quality & Completeness; Technical Excellence; Monad Integration; Track Fit & Problem Relevance; Innovation & Impact.**
- Sponsor bounties: **adherence to the published bounty requirements 40%, Technical Implementation 30%, Monad Integration 20%, Innovation 10%.** Juno's `docs/METROPOLIS.md` independently records the same weights.
- Monad integration requirement (their paraphrase of Rules §9.2): "Contract addresses or tx hashes; mainnet or testnet (either is fine); document why Monad's capabilities are used."
- The often-quoted line "real testnet (or mainnet) transactions on camera; contract addresses and why Monad's speed/cost matters stated explicitly, not just implied" is **that team's own checklist wording**, not official text.

### Bounty texts quoted verbatim by participants (from the dashboard, 2026-09-22) [unverified-official]
Source: same merchant-rails README.
- **Best Use of Envio:** "Meaningfully use Envio's HyperIndex, HyperSync, or HyperRPC to power real on-chain data driving a core feature in your app." Juno's METROPOLIS.md paraphrases extra conditions ("public config/schema/handlers; a frontend using the data"). I could **not** find the full text publicly. It is behind the platform login.
- **Best Mera-Powered UX on Monad:** "Build an app on Monad where Mera is the entire account layer — no seed phrase, no extension, no custody backend." Merchant-rails notes Mera is **mutually exclusive with Privy/Dynamic** bounties. Juno's METROPOLIS.md adds "one passkey prompt; survives a 'stateless test' on a second device".
- "One Passkey, Many Keys": no verbatim text found. Examples of how teams read it:
  - Turnstile derives separate account, door-key and vault keys from one PRF: https://github.com/vaibhav0xq/turnstile
  - Mandate uses separate PRF salts for policy encryption and agent identity: https://github.com/aliveevie/mandate/pull/8

### The "another memecoin bonding curve" page
Not found. I searched the public Metropolis page HTML, hackathon.monad.xyz (login wall), monad-developers/community-resources, Monad blog and events pages, and many web queries. **Recommendation:** ask the user for the URL or check the platform's Resources and Rules tabs. Either way, frame Juno as a *curation market for posts* (Track 03 language), not a launchpad.

### Competitor worth knowing [docs: their README]
**adexto-monad**, a Metropolis Track 01 project: https://github.com/0xcuy/adexto-monad
- "A bonding-curve market that opens on Monad with no liquidity deposit… sub-second candles, and depth priced by the curve itself".
- Uses Envio HyperIndex with a public read-only GraphQL, "verified against contract storage".
- Measured HyperSync backfill at 1.93M blocks in under 45 s, against about 6 h over RPC.
- Argues "Sub-second finality is what makes a 1-second candle mean anything".
- This is the bar Juno's Envio and "why Monad" story will be compared against.

---

## 2. Monad-native capability catalogue

Network facts [docs] https://docs.monad.xyz/ai/current-facts and https://docs.monad.xyz/networks.json:
- Block time 300 ms. Speculative finality in 1 slot, full finality in 600 ms (2 slots). Per-tx gas limit 30M.
- `networks.json` shows testnet `monad_version` 0.16.3 and MIP-8 on testnet since timestamp 1786545000 (2026-08-12). The current-facts page still says v0.16.2.
- Probe: `web3_clientVersion` returned `Monad/0.16.3`. The latest block's `gasLimit` was 150,000,000 and `baseFeePerGas` was 100 gwei (the documented minimum). `eth_maxPriorityFeePerGas` returned 2 gwei. **[probed]**

### 2.1 Speed, finality, commit states
Sources: https://docs.monad.xyz/monad-arch/consensus/block-states and https://docs.monad.xyz/reference/json-rpc/overview#block-tags

| RPC tag | Monad state | Guidance |
|---|---|---|
| `latest` | Proposed (speculatively executed) | freshness |
| `safe` | Voted | QC in hand; reverts need extremely unlikely conditions |
| `finalized` | Finalized | irreversible without a hard fork |

Verified = latest finalized minus the execution delay (the state root has been agreed).

- Probe: latest and safe were both `65106516`, finalized was `65106514`. So finalized ≈ latest − 2 in practice. **[probed]**
- A receipt can come from a non-finalized block. Docs: "compare the returned blockNumber against the finalized block height before acting."
- **How Juno uses it:** show a 3-step pill on every trade: "Seen" (Proposed) → "Locked" (Voted) → "Final" (Finalized). Each step is 300 ms apart and visibly faster than any other chain. This states *why Monad* on camera instead of implying it.

### 2.2 `eth_sendRawTransactionSync` (EIP-7966)
- Docs: supported. https://docs.monad.xyz/reference/json-rpc/api#eth_sendrawtransactionsync
- Release history:
  - Added in v0.12.3.
  - v0.13.0 changed the receipt point from Voted to Proposed ("earlier receipts").
  - v0.14.5 made it event-driven ("up to 100ms" faster), with this caveat: "nodes without execution events will respond with 'method not supported'".
  - Source: https://docs.monad.xyz/developer-essentials/changelog/releases
- The params table lists `timeout_ms` as required, but the single-param form was accepted.
- **Probe results [probed]:**

| Call | Result |
|---|---|
| `eth_sendRawTransactionSync(["0x00"])` | `{"code":5,"message":"The transaction is not ready to be processed"}` (method exists) |
| same with a chain-id-1 signed tx (viem docs example) | `{"code":-32003,"message":"Invalid chain ID: expected 10143, got 1"}` (decodes and validates) |
| control: `eth_totallyFakeMethod` | `-32601 Method not found` |
| Ankr `rpc.ankr.com/monad_testnet` and `rpc-testnet.monadinfra.com` | same `-32003` (supported) |
| `monad-testnet.drpc.org` | free plan refuses the chain |

- **viem [code]:** `node_modules/viem/_esm/clients/decorators/public.js` and `wallet.js` both expose `sendRawTransactionSync`. The implementation sends `[tx]` or `[tx, timeout]` with `retryCount: 0` and throws `TransactionReceiptRevertedError` if `throwOnReceiptRevert`. `publicClient().sendRawTransactionSync` is `function` at runtime.
- **Juno change:** in `lib/juno/tx.ts` (~line 416), replace `sendRawTransaction` + `waitForTransactionReceipt` with `client.sendRawTransactionSync({ serializedTransaction, timeout: 10_000 })`.
  - Fall back to the current path on "method not supported" or `-32601`, because the local anvil and some providers may lack it.
  - This saves a round trip and up to one 500 ms poll.
  - Record the measured submit-to-receipt time and show it ("confirmed in 0.41 s").
  - Caveat: `retryCount: 0` is fine, because resubmitting a signed tx is idempotent by hash.

### 2.3 WebSocket subscriptions: `monadNewHeads` and `monadLogs`
Sources: https://docs.monad.xyz/reference/json-rpc/overview#websocket-subscriptions and https://docs.monad.xyz/monad-arch/realtime-data/spec-realtime

- Docs:
  - `newHeads` and `logs` fire when a block is Proposed and speculatively executed. This changed from Voted to Proposed in v0.14.x.
  - The `monad*` variants also send "subsequent commitment-state updates including `commitState`", plus `blockId`, which is unique per *proposal* (several proposals can share a height).
  - "A block may skip Voted and go directly from Proposed to Finalized."
  - "When a block fails to finalize, it is abandoned implicitly… no explicit abandonment event is published."
  - "Geth-style reorganizations don't occur in the monadNewHeads or monadLogs subscriptions."
  - `syncing` and `newPendingTransactions` are not supported.
- **Probe (6 s on `wss://testnet-rpc.monad.xyz`) [probed]:** all four subscription types were accepted.
  - `monadNewHeads` fields: the standard header plus `blockId` and `commitState`.
  - `monadLogs` fields: `address, blockHash, blockId, blockNumber, blockTimestamp, commitState, data, logIndex, removed, topics, transactionHash, transactionIndex`. `blockTimestamp` is present on plain `logs` too.
  - Observed sequence for block `0x3e17014`: `Voted` at +929 ms, then `Finalized` at +1265 ms. Block `0x3e17015`: `Proposed` at +1254 ms. Block `0x3e17010`: `Verified` at +919 ms. The states interleave across heights as documented.
  - Every block has a log from `0x…1000` (the staking precompile, which appears to emit a per-block event; the event type was not decoded).
- **Live feed/ticker design for Juno:**
  1. The server holds **one** WS connection with `eth_subscribe("monadLogs", { address: launchpad, topics: [[Trade, Launched, Graduated]] })`. The public endpoint allows 50 rps and 100 subscriptions per connection (default per the v0.11 notes), so fan out to phones over SSE or a WebSocket.
  2. Key events by `(blockId, txHash, logIndex)`. Render at `Proposed` as a ghost row ("just now…"). Harden at `Voted`, and confirm at `Finalized`.
  3. When a `Finalized` arrives for height N with a *different* `blockId`, drop the ghost rows from the abandoned proposal.
  4. Use `monadNewHeads` for a "chain heartbeat" dot and to track the finalized height for §2.1 pills.
  5. Envio stays the source of truth for history; the WS tape covers the last ~1–3 s that HyperSync hasn't reached yet (§3.2 measured lag).
- Alternatives:
  - Execution Events SDK (C/Rust, requires running your own Monad node). Fastest, but not practical for a hackathon. https://docs.monad.xyz/execution-events
  - `txpool_statusByHash` / `txpool_statusByAddress` (Monad-specific; exists on public testnet, probe returned `-32000 Unknown tx hash` for a random hash) for a "sent to leader" state before inclusion. https://docs.monad.xyz/reference/json-rpc/api#txpool_statusbyhash

### 2.4 Parallel / optimistic execution and MIP-8 storage pages
Sources:
- https://docs.monad.xyz/monad-arch/execution/parallel-execution
- https://docs.monad.xyz/faq
- https://docs.monad.xyz/developer-essentials/opcode-pricing#storage-pages
- https://mips.monad.xyz/MIPs/MIP-8

- Semantics are identical to serial execution. Transactions run optimistically in parallel; pending results are committed serially and re-executed if an input slot was mutated earlier in the block. "Every transaction will be executed at most twice."
- FAQ, verbatim gist: *"Do I need to change my code to take advantage of Monad's parallelism? … No, no need!"* and *"all state contention is evaluated on a slot-by-slot basis."* Contention only occurs when an earlier tx *writes* a slot a later tx *reads*.
- **Contended storage is not repriced.** Neither the opcode-pricing page nor MIP-8 mentions contention-based pricing. MIP-8: "Existing hashed patterns and dispersed state layouts are not penalized." [docs]
- **MIP-8 (MONAD_TEN):** active on testnet since 2026-08-12 and on mainnet since 2026-09-02. Slots are grouped in 128-slot pages (`page = slot >> 7`); warmth is per (account, page).

| Operation | Gas |
|---|---|
| SLOAD, first touch of a page | 8,100 |
| SLOAD, page already touched | 100 |
| SSTORE | 100 base, +8,000 page load if cold, +2,800 first write to the page, +17,000 per net new slot high-water mark |
| Cold account access | 10,100 |

  Access-list entries warm whole pages. "Each key of a mapping still resolves to its own page, but the struct fields stored under that key share it."

**Juno contract analysis [code]** (`contracts/src/JunoLaunchpad.sol`):
- `_pools[token]` is a ~13-slot `Pool` struct and `_curves[token]` is a separate `Segment[16]`, where `Segment{uint160, uint128}` takes 2 slots, so 32 slots.
- These are two different mappings, so **two different pages** per trade, plus a ~9% and ~24% chance respectively of straddling a page boundary. Merging the curve into the `Pool` struct (45 slots in one keccak region) should save about **one cold page load (8,000 gas) per buy or sell**. The expected page count drops from ~2.33 to ~1.34 (estimate). Because Monad charges the gas **limit**, this is real money for users. **Measure it** with `forge test --network monad --gas-report` (needs Foundry ≥ 1.8). [unverified numbers]
- **Global write hot spots:**
  - `protocolFees[p.quote] += protocol` (in `_accrue`) runs on every trade.
  - `tokens.push(token)` (writes `tokens.length`) runs on every launch.
  - Moving protocol fees to a per-pool field (`p.protocolFees`) with a `claimProtocolFees(quote, tokens[])` sweep removes the only *storage* slot shared by unrelated tokens' trades.
  - But every MON-quoted trade also changes the launchpad's native balance, and every USDC trade writes the launchpad's USDC `balanceOf` slot. A single-vault design (like Uniswap v4's singleton) is inherently one shared balance.
  - Per the FAQ, this costs only cheap re-execution and no gas. Whether Monad merges native-balance deltas commutatively is **[unverified]**.
  - Honest framing for judges: "per-token state, no global counters in the trade path, page-packed curve".
- `ReentrancyGuardTransient` (TSTORE) is already good: no persistent slot is written per call.

### 2.5 Reserve balance (10 MON), `dippedIntoReserve()` at 0x1001, and EIP-7702
Sources:
- https://docs.monad.xyz/developer-essentials/reserve-balance
- https://docs.monad.xyz/developer-essentials/precompiles#reserve-balance-precompile
- https://docs.monad.xyz/developer-essentials/eip-7702

- Execution is asynchronous with k=3 blocks. Consensus budgets each EOA's in-flight **gas** spend at `min(10 MON, lagged balance)`. Execution reverts a tx whose **value** spend drops an account below 10 MON, with one exception.
- The **emptying exception** applies to an *undelegated* sender with no other tx in the past k blocks and no (un)delegation in the past k blocks. Such a tx may dip below the reserve.
- Such reverts are "included but revert", and they still pay gas.
- **Juno implication:** a user with, say, 4 MON who taps Buy twice within ~1.2 s may see the second buy revert on-chain.
  - Mitigation: serialize submissions per wallet on the server (Juno's server already submits), or warn when the balance is below 10 MON and a tx from the same wallet is still in flight.
  - USDC-quoted buys spend no MON value, so only the gas budget applies.
- **`dippedIntoReserve()`**: selector `0x3a61584e`, 100 gas, MIP-4, returns bool. It **must be invoked via CALL**: STATICCALL, DELEGATECALL and CALLCODE revert, and it is intentionally not `view`.
  - Probe: `eth_call` returned `false` **[probed]**.
  - Use: at the end of `buy()`, call it and `revert WouldDipIntoReserve()`. Juno's `revertReason()` can then show "keep 10 MON for fees" instead of an opaque revert. **[idea; unverified that the precompile reports the sender-side dip mid-tx in the way needed]**
- **EIP-7702 on Monad:**
  - A delegated EOA's balance can never dip below 10 MON (no emptying exception).
  - Delegated code cannot `CREATE` or `CREATE2`.
  - Delegating to the staking precompile makes all calls revert.
  - For Juno: 7702 batching (approve+buy in one tx) or sponsorship would make **MON-quoted buys from wallets holding 10 MON or less revert**. Prefer USDC or WMON quotes for delegated users, or keep users undelegated.
  - For the USDC approve+buy two-step, testnet USDC `0x534b…43A3` supports EIP-2612 `permit`: `DOMAIN_SEPARATOR()` answered, `version()` returned `"2"`, `nonces()` answered **[probed]**. A `buyWithPermit` would make it one tx without 7702.

### 2.6 P256VERIFY precompile (0x0100, EIP-7951)
Source: https://docs.monad.xyz/developer-essentials/precompiles#p256-signature-verification
- Input is 160 bytes (`hash‖r‖s‖qx‖qy`). Output is 32-byte `1`, or empty if invalid. 6,900 gas.
- Probe: the EIP-7212/7951 valid vector returned `…0001`, a tampered one returned `0x`, and `eth_estimateGas` returned `0x7837` (30,775 = 21k base + 6.9k + calldata) **[probed]**.
- **Juno uses, with real value:**
  - (a) **Gasless creator actions signed by a passkey.** `claimCreatorFeesBySig(token, to, deadline, webauthnSig)`: the contract verifies a WebAuthn assertion against the creator's registered P-256 key, and Juno's server relays and pays gas.
  - (b) **Authorship attestation:** the post's content hash is signed with the creator's passkey and verified on-chain at `launch`, giving a provable "posted by this human's device".
  - (c) A **P-256 smart account** (Coinbase Smart Wallet, Safe passkey module or Solady WebAuthn lib), so the passkey itself controls funds.
  - The Metropolis Track 04 text explicitly names "P256 and WebAuthn".
  - Note: Mera (below) derives *secp256k1* keys from the passkey's PRF output. P256VERIFY is about the passkey's *own* P-256 signature. These are complementary. Whether Mera's `createPasskeyWithPrfOutput` returns the credential public key is **[unverified]** (its typed result exposes `credentialId`, `transports`, `prfSalt`, `prfOutput`).

### 2.7 Staking precompile (0x1000)
Sources: https://docs.monad.xyz/reference/staking/overview and https://docs.monad.xyz/reference/staking/api
- `delegate(valId)` is payable (min 1 gwei). `undelegate(valId, amount, withdrawId)`, then `withdraw` after `WITHDRAWAL_DELAY` = 1 epoch. Epochs are ~50k blocks (~4 h 12 m) plus a 5,000-round delay.
- `claimRewards` is immediate. `compound` re-delegates.
- **The delegator is `msg.sender`, so a contract can stake.** Only CALL is allowed. There is no code at the address, so "forked testing environments won't work". Foundry ≥ 1.8 has staking cheatcodes.
- Probe via `eth_call`: `getEpoch()` returned `[1303, false]`; `getProposerValId()` returned 185; `getConsensusValidatorSet(0)` returned 100 IDs with `isDone=false` **[probed]**.
- **Juno ideas:**
  - A "creator vault" that delegates a creator's *claimed-but-parked* MON fees and compounds.
  - Protocol fees auto-staked to a chosen validator.
  - "Stake to boost your post": stake stays yours, and the feed ranks by stake-weighted curation.
  - Constraints: withdrawal takes ~1 epoch or more, so this is not for trading capital. It is a credible "native MON yield for creators" story but adds contract surface. Rank it below §2.2, §2.3 and §2.10.

### 2.8 CLZ opcode, 128 KB contracts, gas-limit charging, memory
Sources:
- https://docs.monad.xyz/developer-essentials/differences
- https://docs.monad.xyz/developer-essentials/gas-pricing
- https://docs.monad.xyz/developer-essentials/changelog

- **CLZ (EIP-7939)** has been active since MONAD_NINE (MIP-5). Probe: initcode `PUSH1 1 CLZ …` returned `0xff`, and `clz(0)` returned `0x100` **[probed]**. A use for Juno is MSB/log2 in `CurveMath` sqrt-price math. It requires compiling with an Osaka-aware `evm_version` and Solidity support for `clz` in assembly **[unverified for Juno's solc]**. Juno's `foundry.toml` sets `evm_version = "cancun"`.
- **128 KB max code (256 KB initcode)** since MONAD_FOUR. This lets the launchpad, graduator and a v4 hook live in one contract without diamond or proxy splitting. Minor.
- **Gas charged = gas limit.** Juno already estimates plus a 7.5% margin, citing Category Labs' "7.5% fixed-buffer" in the wallet guide: https://docs.monad.xyz/developer-essentials/wallet-developers. Monad's best-practices page also says to hardcode gas for fixed-cost actions, which saves an `eth_estimateGas` round trip.
- **Memory** is priced linearly, with an 8 MB per-tx cap.
- **Block and tx limits:** block gas 150M (probe confirms). The changelog says MONAD_FOUR raised it to 200M, which conflicts with the probe and the current-facts page; I trust the probe. Per-tx gas limit is 30M.

### 2.9 Other RPC facts that shape Juno [docs][probed]
- `eth_getLogs` is limited to **100 blocks** on `testnet-rpc.monad.xyz`. Probe: 101 blocks returned `-32614 "eth_getLogs is limited to a 100 range"`. Public testnet limits are 50 rps (25 rps for `eth_call`) with batch size 100. Source: https://docs.monad.xyz/developer-essentials/testnet
- `eth_sendRawTransaction` does deferred nonce and balance validation, and `eth_getTransactionByHash` never returns pending txs.
- `debug_trace*` requires a tracer object.

### 2.10 Mera (Category Labs passkey library)
Sources:
- https://docs.monad.xyz/guides/mera
- https://docs.monad.xyz/guides/mera/react-native
- https://mera.category.xyz/
- https://github.com/category-labs/mera
- npm `@category-labs/mera`

- **Version and API [probed npm]:** latest is **0.2.0** (published 2026-08-12, "preview, API may change before 1.0").
  - Exports: `createPasskeyWithPrfOutput`, `getPasskeyPrfOutput`, `createSecp256k1SigningSession`, `createEd25519SigningSession`, `getEvmAddress`, `getSolanaAddress`, `createSecretVaultWithNewPasskey`, `createSecretVaultWithExistingPasskey`, `decryptSecretVaultWithPasskey`, `parseSecretVault`, `isMeraError`.
  - Subpaths: `./viem` (`toViemAccount`) and `./react-native-webauthn-client`.
  - Peer dependencies: `react-native-passkey 3.6.1`, `viem ^2.28.0`.
- **How it works:** a WebAuthn PRF evaluation returns 32 secret bytes. The app derives BIP-39 entropy, then a BIP-44 `m/44'/60'/0'/0/i` secp256k1 key, giving an ordinary EOA that can export to MetaMask.
  - The default salt is `sha256("mera.prf.salt.v1")`. **A custom 32-byte `prfSalt` gives an unrelated output**, which is the mechanism for "One Passkey, Many Keys".
  - Without extra prompts you can also HKDF one PRF output into many keys.
- **React Native requirements [docs]:**
  - Node ≥ 24; Expo **development build** (not Expo Go).
  - iOS 18+ or Android 9+, with a PRF-capable provider.
  - An HTTPS host you control as `rpId`, serving `/.well-known/apple-app-site-association` (`webcredentials`) and `/.well-known/assetlinks.json` with no redirects. Add `associatedDomains: ["webcredentials:<rpId>"]` to app config.
  - `expo-crypto` `getRandomValues` polyfill for Hermes.
  - Pass `reactNativeWebAuthnClient` to every ceremony.
  - Store the PRF output only in biometric-gated SecureStore, never AsyncStorage.
  - The web app and mobile app must share `rpId` for the same account.
- **Juno fit [code]:** `juno-expo/lib/wallet.tsx` already defines `WalletMode = "local" | "privy" | "mera"` and a `SignerSource` seam. The device key (viem `generatePrivateKey` in SecureStore) is the only source today. Bundle ID and package are `fun.juno.app`.
- **"Many keys" concepts that are real for Juno:**
  1. Trading account (index 0).
  2. A **creator posting key** (salt `juno:post:v1`), never funded, that signs post metadata and comments (EIP-712). The server and contract verify authorship.
  3. A **vault key** (salt `juno:vault:v1`) encrypting drafts, DMs or a private watchlist client-side.
  4. A **per-session trading key** with an on-chain spend cap (if a session-key contract is used).
  - Watch the Privy conflict: Mera bounties exclude Privy/Dynamic.

### 2.11 Ecosystem primitives on testnet: presence verified by `eth_getCode` [probed]

| Primitive | Address (10143) | Code | Source / use for Juno |
|---|---|---|---|
| WMON | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` | 3,249 B ("Wrapped MON", WMON, 18) | testnet page. Quote asset for 7702-safe trades; v4 pools |
| USDC | `0x534b2f3A21130d7a60830c2Df862319e593943A3` | 1,798 B (proxy; "USDC", 6 dp; EIP-2612 v2) | Juno already uses it. Permit-based one-tx buys |
| Uniswap v4 PoolManager | `0x451D64ab3b650040d2aE1886602b97ed6eDc643d` | 34,582 B | https://docs.monad.xyz/guides/uniswap-v4-hooks/customize-and-publish. **Unofficial testnet deployment** (differs from Uniswap mainnet list); also PositionManager `0x3Bb1…C31A`, StateView `0xB639…153c`, V4Quoter `0x8698…94C7` (6,118 B), UniversalRouter 2.1.1 `0x1b7b…3c22` (24,546 B) |
| Kuru Router / MarginAccount / Forwarder | `0x7EFbE105…4630` / `0xd029C2D9…CE02` / `0x681bB150…9BB4` | 141 B each (proxies); OrderBookImpl `0x72caE0a9…9374` 35,548 B; MON/USDC market `0xa241…D2D9` | https://docs.kuru.io/contracts/Contract-addresses and monad-crypto/protocols `testnet/kuru.jsonc`. Kuru's testnet USDC is a *different* token `0x3bA3…1570`. Kuru bounties are Track 01 only |
| nad.fun | registry `testnet/nad_fun.jsonc` | **BondingCurve/Router/DEX_ROUTER have no code**; only LENS proxy (163 B) | stale after testnet changes. Mainnet addresses (`0x6F6B…1A22` etc.) have code on 143 only. Not usable on testnet |
| Pyth (upgraded) | `0xFC6bd9F9f0c6481c6Af3A7Eb46b296A5B85ed379` | 177 B (proxy) | Juno's `lib/juno/pyth.ts`. Not in Monad docs, which list `0x2880…7B43`; both have code |
| Pyth (original) | `0x2880aB155794e7179c9eE2e38200202908C17B43` | 177 B | https://docs.monad.xyz/tooling-and-infra/oracles |
| Pyth Entropy (VRF) | `0x36825bf3Fbdf5a29E2d5148bfe7Dcf7B5639e320` | 8,061 B | e.g. random "lucky buyer" creator airdrops |
| Stork (pull, has MON/USD) | `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` | 170 B | oracles page |
| Chainlink | testnet feeds via docs.chain.link (page too large to fetch) | **[unverified]** | mainnet list in monad-crypto/protocols `mainnet/chainlink.jsonc`; CRE bounty is separate |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | 3,808 B | Juno uses it via viem batching. Docs note Multicall runs calls serially; JSON-RPC batches run in parallel |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | 9,152 B | signature transfers for any ERC-20 quote |
| EntryPoint v0.7 / v0.8 / v0.9 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` / `0x4337084d9e255fF0702461CF8895cE9E3b5Ff108` / `0x433709009B8330FDa32311DF1C2AFA402eD8D009` | 16,035 / 21,738 / 22,425 B | 4337 smart accounts (P-256 signers), paymasters |
| CreateX | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` | 11,838 B | same launchpad address on testnet and mainnet |
| ERC-6492 validator, Safe 1.4.1 set, SafeSingletonFactory | listed on testnet page | present | |
| AUSD | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` | 5,937 B | Agora bounties (Track 01/02) |

**Strongest composition for Juno:** graduate into a **Uniswap v4 pool with a Juno hook**.
- The hook keeps routing a creator fee after graduation, so the "creators earn" story survives graduation.
- Monad docs ship a v4-hooks guide and testnet deployment (links above), so this reads as a Monad-endorsed path.
- Today Juno deploys its **own** Uniswap v2 factory on testnet ("No official Uniswap v2 here: the script deploys one" in `contracts/script/Deploy.s.sol`).

### 2.12 Tooling caveat (blocks everything above) [code][docs]
- Foundry ≥ 1.8 adds first-class Monad execution: `network = "monad"` in `foundry.toml` or `--network monad`, and `anvil --network monad`. That covers the gas model, gas-limit charging, MIP-8 pricing, Monad precompiles and staking cheatcodes, and it auto-selects the hardfork when forking. Source: https://docs.monad.xyz/tooling-and-infra/toolkits/foundry
- Juno's local toolchain is **forge/anvil 1.7.1**, and dev points at `127.0.0.1:8545`. A 1.7.1 anvil fork reports Ethereum gas, has no 0x1000 or 0x1001, and likely lacks `monadLogs`/`monadNewHeads` and possibly `eth_sendRawTransactionSync` **[unverified for anvil]**.
- Upgrade Foundry, and demo on real testnet.

---

## 3. Envio (HyperIndex 3.x, HyperSync, HyperRPC, Envio Cloud)

### 3.1 Bounty
- Headline requirement: "Meaningfully use Envio's HyperIndex, HyperSync, or HyperRPC to power real on-chain data driving a core feature in your app." Quoted by the merchant-rails repo from the dashboard.
- Prize: $1,000, plus Envio Cloud hosting for winners (public page).
- Judging: 40% adherence, 30% technical, 20% Monad integration, 10% innovation (participant-quoted Rules).
- Full text, including any "public config/schema/handlers, frontend, demo" clauses, is **[unverified]**: login-gated.
- Examples of what competing teams show:
  - Turnstile: "Nothing in the live layer is read over RPC"; freshness chips comparing indexer head vs relayer. https://github.com/vaibhav0xq/turnstile
  - adexto: public read-only GraphQL; indexer numbers cross-checked against contract storage. https://github.com/0xcuy/adexto-monad

### 3.2 Feature catalogue (docs index: https://docs.envio.dev/llms.txt)

| Feature | What it gives | Notes / source |
|---|---|---|
| Dynamic contracts (`indexer.contractRegister` + `context.chain.X.add`) | Factory pattern | "Envio will index all events from that contract in the same block where it was created, even if those events happened in transactions before the registration event." https://docs.envio.dev/docs/HyperIndex/dynamic-contracts. v3.5 supports "billions of addresses" |
| Multichain | Multiple chains in one indexer; `disable_default_cross_chain: true` gives per-chain rows | v3.9 per-chain Postgres partitions; v3.10 **isolated multichain rollbacks** when no `@crossChain` entity. https://docs.envio.dev/docs/HyperIndex/whats-new-in-v3 |
| Effect API (`createEffect`) | External calls from handlers: batching, memoization, dedup, `cache: true` persistence, `rateLimit`, `crossChain: false`. `context.cache=false` skips caching failures | Envio Cloud can save and restore effect caches ("Medium plans and up" on paid). Effects are **not rolled back on reorg**. https://docs.envio.dev/docs/HyperIndex/effect-api |
| Preload optimization | Always on in v3. Handlers run twice (parallel preload with reads only, then ordered processing); `context.isPreload` | https://docs.envio.dev/docs/HyperIndex/preload-optimization |
| `getWhere` | Hasura-style `_eq/_gt/_gte/_lt/_lte/_in`, multi-field since v3.2 | "Very large getWhere queries might cause memory overflows". https://docs.envio.dev/docs/HyperIndex/event-handlers |
| `getOrCreate` / `getOrThrow` | Entity loader helpers | same page |
| Block handlers (`indexer.onBlock`, `where` gives `_gte/_lte/_every`) | Periodic logic, time series | **Handler receives only `block.number`** (typed `{ readonly number: number }` in envio 3.12.1 `index.d.ts`; extended fields "opt-in via field_selection" [unverified]). Runs twice (preload). On Monad, `_every: 200` ≈ 1 min. https://docs.envio.dev/docs/HyperIndex/block-handlers |
| GraphQL subscriptions | `wss://…/graphql`, Hasura live queries | "available but should be used at your own risk on plans other than dedicated… don't recommend… more than 10 concurrent connections." https://docs.envio.dev/docs/HyperIndex/websockets |
| Wildcard indexing and topic filtering | `wildcard: true`, `where` returning param filters per chain | https://docs.envio.dev/docs/HyperIndex/wildcard-indexing |
| RPC for realtime | `rpc: { url, ws, for: realtime }` (WS experimental); `block_lag`; `start_block: latest` (v3.11) | whats-new-in-v3 |
| Reorgs | `rollback_on_reorg: true` default; `max_reorg_depth` default 200 | "Reorg detection is guaranteed when using HyperSync." Side effects are not rolled back. https://docs.envio.dev/docs/HyperIndex/reorgs-support |
| `@internal` entities, descriptions, `@index` (composite, DESC), ClickHouse storage (experimental) | | whats-new-in-v3 |
| Observability | TUI, Prometheus `/metrics`, `_meta` query for sync status, Dev Console | https://docs.envio.dev/docs/HyperIndex/observability |
| Testing framework | Simulated events, no Docker | Juno already uses it |
| HyperSync (direct) | `@envio-dev/hypersync-client` (Node, TS, Rust core); logs, txs, blocks and traces with field selection. Monad testnet: `https://monad-testnet.hypersync.xyz` (or `10143.hypersync.xyz`) | API token required. https://docs.envio.dev/docs/HyperSync/hypersync-clients, https://docs.envio.dev/docs/HyperSync/api-tokens |
| HyperRPC | Read-only JSON-RPC (`eth_getLogs`, blocks, receipts, txs); `https://monad-testnet.rpc.hypersync.xyz/<token>` | Probe without a token returns HTTP 401 "Your token is malformed". https://docs.envio.dev/docs/HyperRPC/overview-hyperrpc |
| Envio Cloud | GitHub-app deploys per branch, GraphQL endpoint, effect-cache management, monitoring | https://docs.envio.dev/docs/HyperIndex/hosted-service |

Envio's Monad support:
- HyperSync supports Monad testnet 10143 and mainnet 143: https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks
- Monad docs promote Envio (best-practices page, an HyperIndex Telegram-bot guide, a HyperSync token-snapshot guide): https://docs.monad.xyz/developer-essentials/best-practices and https://docs.monad.xyz/guides/indexers/tg-bot-using-envio

**Measured HyperSync head lag on Monad testnet [probed]:** the `/height` endpoint is public, and HyperSync trailed RPC `latest` by **2–3 blocks (≈0.6–0.9 s)** over 6 samples. That is about the finalized height, so the indexer is roughly 1 s behind the head. The §2.3 WS tape covers that gap.

### 3.3 Envio Cloud free tier and HyperSync pricing
Development plan: free.
- Hard limits: deleted at >20 GB, or after **30 days**.
- Soft limits, whichever comes first: **100,000 events processed, 5 GB, or 7 days with no requests**. Breaching one triggers a 7-day grace period, then 3 days read-only, then deletion.
- "800 indexing hours per month."
- Sources: https://docs.envio.dev/docs/HyperIndex/hosted-service-deployment, https://docs.envio.dev/docs/HyperIndex/hosted-service-billing, https://envio.dev/pricing
- Cloud indexers need no API token.
- **Timing:** a deploy made now (24 Sep) expires around 24 Oct, *during* judging (14–27 Oct). Redeploy around 1–10 Oct, and keep querying it (the 7-day idle rule).

HyperSync pricing (https://envio.dev/pricing/hypersync): Free is "fair-use based rate limiting"; Starter $70/mo is 100 rpm; Pro $480/mo is 1,000 rpm.

### 3.4 Juno's indexer: genuinely used vs missing [code]
Files: `indexer/config.yaml`, `indexer/schema.graphql`, `indexer/src/EventHandlers.ts`, `indexer/src/quotes.ts`, `lib/juno/envio.ts`, `lib/juno/swaps.ts`, `lib/juno/leaderboard.ts`, `lib/juno/portfolio.ts`.

**Used, and done well:**
- HyperIndex v3 unified API (`indexer.onEvent`) across 9 launchpad events.
- **Dynamic registration:** `contractRegister` on `Launched` adds `JunoToken` and indexes every token's `Transfer`, relying correctly on same-block backfill to see the constructor mint. This gives real balances and `holderCount`.
- **Effect API** (`erc20Decimals`: `cache: true`, `rateLimit` 5/s, `crossChain: false`, `context.cache=false` on failure). In practice it is rarely hit, because MON and USDC decimals are hard-coded.
- Preload-aware handlers (all reads up front via `Promise.all`).
- Multichain config (10143 active, 143 `skip`), `disable_default_cross_chain: true`, per-event `field_selection` for tx hash, `ENVIO_`-prefixed env interpolation.
- Rich schema: `@index`, composite indexes (`token,blockNumber,logIndex`), `@derivedFrom`, docstrings. Average-cost basis and `realizedPnl` per `Position`; per-quote totals.
- Vitest handler tests on simulated events. README with Envio Cloud steps.

**Missing or unused. These matter for "drives a core feature":**
1. **The app reads one entity.** `envio.ts` only queries `Trade`, and `swaps.ts` only calls it by token (limit 200, merged with recent receipt rows). Nothing reads:
   - `Position` (balance, costBasis, realizedPnl), `Account`, `Pool` (holderCount, volumeQuote, creatorFeesEarned/Claimed, progress), `QuoteToken`, `Launchpad`, `Graduation` or `CreatorClaim`.
   - `leaderboard.ts` says "with no indexer, no new table". It walks per-pool trade history and recomputes basis.
   - `portfolio.ts` reads balances by RPC.
   - **Fix:** portfolio = one `Position(where:{trader,balance>0})` query; leaderboard = `Position(order_by: realizedPnl desc)` or an `Account` aggregate; coin page = `Pool` + holders + creator earnings; profile = `CreatorClaim` + launches; trending = `Pool(order_by: volume24h)`.
2. **Not deployed or wired.** `ENVIO_GRAPHQL_URL` is empty in `.env.local`, the launchpad isn't on real testnet (§0.6), and the config defaults to the `0x0` placeholder.
3. **No post-graduation indexing.** After `Graduated`, trading moves to the Uniswap v2 pair (`venue`, known at `Launched`). The indexer never registers the pair, so no `Swap`/`Sync` events are indexed. Price, volume and cost basis stop at graduation, although `Transfer` balances continue. **Fix:** add a `JunoPair` contract (`Swap`, `Sync`, `Mint`, `Burn`) and `context.chain.JunoPair.add(venue)` in the same `contractRegister`. Or index Juno's own testnet v2 factory `PairCreated`.
4. **No time series.** There are no candles or daily stats; charts are computed in the app (`swaps.ts` builds candles from trades).
   - **Fix:** event-driven `Candle` entities keyed `${token}-${interval}-${bucketStart}` for 1s/1m/5m/1h. Upsert OHLC and volume inside the `Trade` (and pair `Swap`) handler from `event.block.timestamp`.
   - Add `PoolHourData` and `ProtocolDayData`.
   - Prefer events over `onBlock`, which only gets `block.number` and runs on every 300 ms block unless `_every` is set.
   - This also enables "sub-second candles", matching adexto's claim.
5. **No live queries.** There are no GraphQL subscriptions. Given the ≤10-connection caveat on non-dedicated plans, run **one server-side subscription** to `Trade(order_by: blockNumber desc, limit: 20)` and fan out to phones, or use the §2.3 Monad WS tape for the head and Envio for everything older.
6. **No HyperSync or HyperRPC use outside the indexer.** The app's fallback is a 100-block `eth_getLogs` tail (`recentTradesFromLogs`).
   - Replace it with HyperRPC (`eth_getLogs` over the full range) or `@envio-dev/hypersync-client` (`get` with log selection on launchpad `Trade`) for ad-hoc history or backfill without the indexer.
   - Also useful for a wallet's *other* holdings: "this trader also holds…", via ERC-20 `Transfer` topic filtered by address.
   - Needs `ENVIO_API_TOKEN` server-side.
7. **Effect API is under-used.** Candidates:
   - `ipfsMetadata(uri)` (`cache: true`) so GraphQL serves the post caption and media type without the app DB.
   - `pythPrice(feedId, minuteBucket)` to store `usdValue` per trade.
   - A **creator notification webhook**: `sendWebhook` effect gated on `context.chain.isRealtime && !context.isPreload`, pushing "someone bought your post — you earned X MON". Effects aren't rolled back on reorg, so only notify at, or after, the lag.
8. **Reorg tuning.** `max_reorg_depth` is left at the default 200. Monad finalizes in 2 blocks and HyperSync already trails by ~3, so a small value (e.g. 10) cuts rollback bookkeeping. **[unverified: Envio's recommendation for Monad]**
9. **No freshness surface.** Show `_meta` (indexer head) vs chain head in the UI, like Turnstile's "freshness chip". Judges can then see Envio is live.
10. **Small items:**
    - `bytes_type: uint8array` (v3.10) halves address storage.
    - Per-handler `fields` (v3.7) instead of global `field_selection`.
    - `@internal` for helper entities.
    - Mark `Trade` immutable-ish, or move it to ClickHouse if analytics grow.

**Suggested priority for the bounty:** (2) deploy on real testnet and Envio Cloud → (1) portfolio, leaderboard, coin stats and creator earnings read from Envio → (4) candles → (3) pair indexing → (5) live tape → (6) HyperSync/HyperRPC fallback → (7) notifications and metadata effects → (9) freshness chip.

---

## 4. Ranked "deep integration" menu for Juno

| # | Item | Monad-native? | Envio? | Effort | Why it scores |
|---|---|---|---|---|---|
| 1 | Deploy to real testnet (Foundry ≥ 1.8 `--network monad`), Envio Cloud live, links in JUNO.md | yes | yes | S | Prerequisite for "Monad Integration" and bounty adherence |
| 2 | `sendRawTransactionSync` + commit-state pills (Proposed/Voted/Finalized) with measured latency | yes | – | S | Speed shown on camera and stated explicitly |
| 3 | `monadLogs` live trade tape with `blockId` handling | yes | complements | M | Monad-specific API; realtime social feed |
| 4 | App reads Position/Pool/Account/CreatorClaim from Envio (portfolio, leaderboard, creator earnings, holders) | – | yes | M | "Drives a core feature" |
| 5 | Event-driven candles plus pair indexing after graduation | – | yes | M | Complete market data |
| 6 | Mera account layer (Expo dev build, `rpId` domain) plus "many keys" (posting, vault) | yes (Category Labs) | – | M–L | $2.5k ×2 bounties; Track 04 signal; conflicts with Privy |
| 7 | MIP-8-aware layout (curve in `Pool` struct), per-pool protocol fees; measured gas | yes | – | S–M | "Designed for Monad" with numbers |
| 8 | Reserve-balance-aware UX (per-wallet submit serialization; `dippedIntoReserve` friendly revert) | yes | – | S | Shows real understanding of Monad semantics |
| 9 | P256VERIFY: passkey-signed gasless creator fee claims or authorship attestations | yes | – | M | Track 04 language |
| 10 | Graduate into Uniswap v4 (testnet PoolManager) with a creator-fee hook | ecosystem | index hook events | L | Composability; creators keep earning |
| 11 | USDC `permit` one-tx buys (instead of approve+buy) | EVM | – | S | Fewer in-flight txs; fits reserve-balance rules |
| 12 | Staking precompile creator vault | yes | – | M–L | Novel but slow (epoch delays) |

---

## 5. Unverified / open items
- Full official text of the Envio, Mera and "One Passkey, Many Keys" bounties, the official judging rubric wording, and the "another memecoin bonding curve" resource page. All are behind the hackathon.monad.xyz login.
- Whether a Foundry 1.7.1 anvil fork supports `eth_sendRawTransactionSync`, `monadLogs` or the Monad precompiles (expected: no).
- Whether Monad's parallel executor treats native-balance increments on a shared contract as conflicts in the same way as storage slots.
- Gas saving from merging `_curves` into `Pool`: an estimate (~8k gas per trade) that needs measuring.
- Envio `onBlock` block fields beyond `number` (types say opt-in via `field_selection`, not tested). HyperIndex RPC-realtime `ws` against Monad WS (experimental, not tested). Recommended `max_reorg_depth` for Monad.
- Chainlink testnet feed addresses on Monad (the docs page was too large to fetch).
- Block gas limit: the probe shows 150M, while the changelog says MONAD_FOUR raised it to 200M.
- Does `dippedIntoReserve()` called inside the launchpad reflect the *sender's* dip in a way usable for a friendly revert? Semantics per MIP-4 were not tested with a real tx, by design.

## 6. Sources
Monad docs:
- https://docs.monad.xyz/llms.txt, https://docs.monad.xyz/llms-full.txt
- https://docs.monad.xyz/ai/current-facts, https://docs.monad.xyz/networks.json
- https://docs.monad.xyz/developer-essentials/differences
- https://docs.monad.xyz/developer-essentials/reserve-balance
- https://docs.monad.xyz/developer-essentials/eip-7702
- https://docs.monad.xyz/developer-essentials/precompiles
- https://docs.monad.xyz/developer-essentials/opcode-pricing
- https://docs.monad.xyz/developer-essentials/gas-pricing
- https://docs.monad.xyz/developer-essentials/best-practices
- https://docs.monad.xyz/developer-essentials/testnet
- https://docs.monad.xyz/developer-essentials/wallet-developers
- https://docs.monad.xyz/developer-essentials/changelog, https://docs.monad.xyz/developer-essentials/changelog/releases
- https://docs.monad.xyz/reference/json-rpc/overview, https://docs.monad.xyz/reference/json-rpc/api
- https://docs.monad.xyz/monad-arch/consensus/block-states
- https://docs.monad.xyz/monad-arch/realtime-data/data-sources, https://docs.monad.xyz/monad-arch/realtime-data/spec-realtime
- https://docs.monad.xyz/monad-arch/execution/parallel-execution, https://docs.monad.xyz/faq
- https://docs.monad.xyz/node-ops/upgrade-instructions/page-storage-mip-8-migration
- https://mips.monad.xyz/MIPs/MIP-8
- https://docs.monad.xyz/reference/staking/overview, https://docs.monad.xyz/reference/staking/api
- https://docs.monad.xyz/guides/mera, https://docs.monad.xyz/guides/mera/react-native
- https://docs.monad.xyz/guides/uniswap-v4-hooks/customize-and-publish
- https://docs.monad.xyz/tooling-and-infra/oracles
- https://docs.monad.xyz/tooling-and-infra/toolkits/foundry
- https://docs.monad.xyz/guides/kuru-flow

Monad hackathon: https://monad.xyz/developers/hackathons/metropolis, https://hackathon.monad.xyz/

Mera:
- https://mera.category.xyz/
- https://github.com/category-labs/mera
- https://www.npmjs.com/package/@category-labs/mera

Ecosystem:
- https://docs.kuru.io/contracts/Contract-addresses
- https://github.com/monad-crypto/protocols (`testnet/kuru.jsonc`, `testnet/nad_fun.jsonc`, `mainnet/chainlink.jsonc`)
- https://github.com/Naddotfun/contract-v3-abi

Envio:
- https://docs.envio.dev/llms.txt
- https://docs.envio.dev/docs/HyperIndex/whats-new-in-v3
- https://docs.envio.dev/docs/HyperIndex/dynamic-contracts
- https://docs.envio.dev/docs/HyperIndex/effect-api
- https://docs.envio.dev/docs/HyperIndex/preload-optimization
- https://docs.envio.dev/docs/HyperIndex/event-handlers
- https://docs.envio.dev/docs/HyperIndex/block-handlers
- https://docs.envio.dev/docs/HyperIndex/websockets
- https://docs.envio.dev/docs/HyperIndex/wildcard-indexing
- https://docs.envio.dev/docs/HyperIndex/reorgs-support
- https://docs.envio.dev/docs/HyperIndex/latency-at-head
- https://docs.envio.dev/docs/HyperIndex/hosted-service-deployment
- https://docs.envio.dev/docs/HyperIndex/hosted-service-billing
- https://docs.envio.dev/docs/HyperSync/hypersync-clients
- https://docs.envio.dev/docs/HyperSync/api-tokens
- https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks
- https://docs.envio.dev/docs/HyperRPC/overview-hyperrpc
- https://envio.dev/pricing, https://envio.dev/pricing/hypersync

Participant repos (secondary sources for rubric and bounty text):
- https://github.com/precious-akpan/monad-metropolis-merchant-rails
- https://github.com/vaibhav0xq/turnstile
- https://github.com/0xcuy/adexto-monad
- https://github.com/aliveevie/mandate/pull/8
- https://github.com/Sireadell/headwater-indexer

Probe scripts and outputs: this scratchpad directory (`ws-probe.mjs`/`ws-out.json`, `probe.mjs`, `probe2.mjs`, `probe3.mjs`, `staking2.mjs`, `docs/`, `envio/`, `repos/`).
