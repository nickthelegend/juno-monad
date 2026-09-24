# A skeptical judge's verdict on Juno

Written 2026-09-24 as a Metropolis judge would see it: from the running app in
Chrome, the repository and the claims in its README, looking for anything
mocked, faked or overstated. This document judges; it fixes nothing.

What was in front of the judge: the Expo web build on `localhost:3000`, the
API on `:3100`, and Juno's contracts **on a local fork of Monad testnet**. No
real-network deployment exists yet. The judge launched a photo post, bought,
sold, filled a curve, graduated it to Uniswap v2 and to Kuru, traded on Kuru
with market and limit orders, opened and closed a Perpl position, claimed
creator fees, commented, liked and saved.

## Scores (Metropolis criteria, 20% each)

| Criterion | Score /10 | Why |
|---|---|---|
| Product quality | 7.5 | Every core flow works end to end and says what happened in plain words. Unknowns show as dashes, never as zeros. The seams show on first contact: coins launched by script have generated art, the dev bundle is slow to first paint, and the web build is the only one a judge can open. |
| Technical excellence | 8 | Sixteen-range curves with a TypeScript↔Solidity parity suite and fuzzed invariants. A counterfactual Uniswap pair locked at launch. A Kuru graduator that blocks every route into Kuru before graduation, tested against Kuru's live contracts. An indexer that follows coins into their Kuru markets. It loses points because all of it is proven only on a fork. |
| Monad integration | 6 | Monad is designed in: `eth_sendRawTransactionSync`, the commit-state WebSocket, gas billed on the limit, the reserve-balance rule, the 100-block `getLogs` cap. None of it has met the real chain with Juno's contracts. The "confirmed in 1.2s" the judge saw timed anvil, and the live tape and finality timeline showed nothing for Juno's trades, because they were not on Monad. |
| Track fit (03, Social, Attention & Culture) | 7 | "The post is the market" is squarely Track 03, and the creator-fee loop is the right social mechanic. Perps on BTC and ETH have nothing to do with attention or culture, and Kuru's prizes sit in Track 01. To a Track 03 judge the Trade tab reads as scope creep. |
| Innovation | 6.5 | Posts as tokens is a crowded idea. What is new: curve *shapes* chosen per post, the creator choosing the venue a post graduates into (a new Kuru market per post), and pre-IPO trackers priced against Tessera's marks. |
| **Weighted** | **7.0** | |

## Hunting for fakery

Nothing on screen was invented. Specifically:

- **Trades are real transactions.** Each "Done" came with a hash the fork's
  RPC returns. Balances, holders and positions changed as the contracts say
  they should, and the indexer agreed with the chain.
- **Holders are real.** The coin page says where each list comes from and how
  current the indexer is ("current to block 65,187,323"). When Docker died
  mid-review, the leaderboard said it was incomplete instead of pretending.
- **Prices after graduation are real.** A Uniswap-graduated coin is priced
  from the pair's reserves, and a Kuru coin from its live book, not from the
  frozen curve.
- **Perps market data is real.** Marks, funding and open interest come live
  from Perpl's testnet API.

Where a judge should be careful:

1. **"Confirmed on Monad in 1.2s" is anvil's number here.** On the fork it is
   true of the fork. Record the demo on real testnet or say what it is.
2. **Perps trading was exercised with a crutch.** On the fork, AUSD was
   written into the test wallet's storage and a keeper disabled Perpl's
   oracle-age check. The order encoding was also simulated against live
   testnet state, which is honest evidence, but no one has opened a real
   Perpl position through Juno. The docs say so; the demo must too.
3. **Privy login has not been completed by the team's reviewer.** The modal
   opens and the server rejects a bad token, but no one has signed a
   transaction through Privy yet.
4. **Script-launched coins have identicon art.** That looks thin next to
   posts with real photos. It is not fake, but it is weak demo material.

## Ranked issues

| # | Severity | Issue |
|---|---|---|
| 1 | Blocker | **Nothing is deployed to Monad testnet.** No contract address, no MonadVision link, no transaction a judge can click. Every Monad-specific claim is unverifiable from outside. The deployer (`0x019E…CaaC`) has 0 MON. |
| 2 | High | The two headline Monad features, the commit-state tape and per-trade finality, show nothing for Juno's own trades until item 1 is fixed. |
| 3 | High | Track focus. Perps and a heavy Kuru story dilute a Track 03 pitch; Kuru's and Perpl's prizes need Track 01. Pick one story for the video. |
| 4 | Medium | The Privy flow has not been completed end to end (login → embedded wallet → a signed trade). The Privy bounty requires more than login, so this has to be shown working. |
| 5 | Medium | The Envio indexer runs locally in RPC mode. There is no public endpoint, so a judge cannot query it. |
| 6 | Medium | Only the web build is demonstrable. The native app exists, but not as TestFlight or an APK. |
| 7 | Low | First paint of the dev build takes about 10s; a production web export would fix it. |
| 8 | Low | Four issues the first test pass found are fixed in `e51a19b`: accessibility states, Kuru labels, book-price precision and suggester wording. They were visible to a careful judge before that. |

## The single biggest blocker

**Deploy to Monad testnet and run one full lifecycle there.** Launch, buy,
sell, fill, graduate (one to Uniswap, one to Kuru), trade on Kuru, claim. Put
the addresses and transaction links in `JUNO.md`, and point the indexer at
testnet. Until then a judge has a well-built local demo and no evidence it
runs on Monad. About 1 MON of testnet gas unblocks it:
`contracts/deploy.sh testnet` is ready.

## Would it place?

**As it stands: no.** A judge cannot verify it on Monad, and Metropolis
weights Monad integration at 20%.

**Deployed, with a tight Track 03 video: it contends for the podium.** The
product is coherent and honest in a way most hackathon entries are not, and
the engineering depth (curve parity, counterfactual pairs, the Kuru venue,
indexer-backed positions) holds up under inspection. Sponsor bounties:

- **Envio**: a strong candidate, once it is hosted.
- **Kuru "New Assets and Markets"**: a literal fit, but only if the team enters Track 01.
- **Privy**: possible, once the signing flow is shown working.

## Re-judged later the same day

Same method, after the second test pass and the fixes it produced
(`38a7d51` to `7a20c26`).

| Criterion | Before | Now | Why it moved, or did not |
|---|---|---|---|
| Product quality | 7.5 | 8 | Numbers on one screen now agree with each other: price impact without the fee, a sell hint that respects what you hold, trade rows that say what was paid, a "Trades" count that counts trades. Reels were seen playing with their market dock. No console errors or warnings on any screen |
| Technical excellence | 8 | 8 | Slither found one real trap (a pool with no graduator could strand its buyers' quote), fixed with a test. The indexer's broken typecheck was caught. Still proven only on a fork |
| Monad integration | 6 | 6 | Unchanged, and it cannot change from inside the repo: nothing is on testnet. The fork now labels itself everywhere, so no demo credits Monad with anvil's timings |
| Track fit | 7 | 7 | Unchanged |
| Innovation | 6.5 | 6.5 | The Kuru market's address from launch is neat, not new |
| **Weighted** | **7.0** | **7.1** | |

**Fakery.** Still none found. The one piece of misleading copy (Monad credited
with a fork's confirmation time) is gone.

**Ranked issues now.** 1. Nothing on Monad testnet (blocker, unchanged).
2. The Privy flow has never been completed by a person. 3. The indexer is not
hosted. 4. Only the web build is demonstrable. 5. Track focus: perps and Kuru
dilute a Track 03 story.

**Verdict.** Unchanged: it does not place until it is on Monad testnet, and it
contends once it is.
