# Recording runbook: the 3-minute video, on the live app

**App:** <https://juno-monad-app.vercel.app> (Monad testnet). Record at 1440×900 in Chrome. Show phone width (390) once, via DevTools device mode, at step 3.

## Before you press record
- **Browser:** a fresh Chrome profile, or an incognito window, so it is a first visit. On a Mac with Touch ID, Chrome's passkeys support PRF, which Mera needs. If not, use the device-key fallback at step 4.
- **Tabs to have open:**
  1. the app's landing;
  2. <https://testnet.monadvision.com/tx/0x04de4115b0a993676289c9c94b98f9d96f5927c5ea56d1262312dce5ef715bda>, the Kuru graduation, as a backup;
  3. the repo.
- **Coins used** (seeded on testnet):

  | Coin | Address | What it is |
  |---|---|---|
  | `$BLOOM` | `0x2DA4841d9694Ae7Ac6D609D824EbD9A1FBf96754` | a photo post on its curve |
  | `$GRADKURU` | `0x79513F4Ac0B112E690679dBea4A02d468B92bAB8` | graduated into Kuru |
  | `$OPENAIX` | `0xF34418970aB181953F1efb1D353bd232d291e848` | pre-IPO tracker, CRE-attested |

- **A photo** to post, saved on the desktop.
- **Warm the server:** open the landing once 1 minute before recording, so the live strip is already connected.

## The path

| # | Seconds | Click | On screen | Caption |
|---|---|---|---|---|
| 1 | 0:00–0:15 | Landing; wait 3 s | The live panel: markets, trades, ms to confirm, the block ticking. Monad testnet's blocks move Proposed → Voted → Finalized → Verified. **Pause on the chips.** | "Every post is a market on Monad. That's Monad live: 300 ms blocks, final in under 600." |
| 2 | 0:15–0:22 | Get Started | The feed, with rails on both sides: Monad live, and the most traded coins | "Posts, and every one is a market." |
| 3 | 0:22–0:45 | Buy on the first post. *Create a wallet to trade* → *Get testnet MON* (0.5 MON) → the first quick size → Buy | Done. Two big timers, **Executed ~300–450 ms** and **Final ~580 ms**, then *Paid here* against *Same gas on Ethereum*. **Pause 2 s on the timers.** | "No wallet to done in one sheet. Executed in one round trip, final in about 600 ms, for a fraction of a cent." |
| 4 | 0:45–1:00 | Profile (bottom right) → *Create a passkey account* → Touch ID → Wallet tab → *Prove my passkey on Monad* | "Verified by Monad's P256 precompile" | "One passkey is the whole account, through Mera, and Monad's own precompile checks it." |
| 5 | 1:00–1:15 | + → pick the photo → name it → Launch | One transaction, then the new post in the feed | "Publishing is one transaction: token, curve, and the lock on its future market." |
| 6 | 1:15–1:35 | Search (magnifier) → "gradk" → `$GRADKURU` | The coin page: the *Order book on Kuru* badge, bid and ask, Activity rows tagged KURU | "When a curve fills, the post opens its own Kuru order book, seeded from its raise and locked." |
| 7 | 1:35–1:55 | Trade (bottom bar) → Perps → *Get AUSD* → BTC → Long 2x → open → Risk → Close | Badges: *Perps on Perpl*, *Margin in Agora AUSD*. The position, then distance to liquidation in Risk. | "Perps on Perpl with Agora's AUSD, and a risk view built on Perpl's API." |
| 8 | 1:55–2:10 | Search → "openai" → `$OPENAIX` | *NAV attested by Chainlink CRE · Xm ago* under the title | "Pre-IPO trackers, marked against Tessera, attested on chain by a Chainlink CRE workflow." |
| 9 | 2:10–2:30 | Back to step 3's receipt (or buy `$BLOOM` again) → *Share this receipt* | The 1200×630 card: the ms, final, the trade, its cost against Ethereum | "Every receipt is a card you can post." |
| 10 | 2:30–2:50 | Profile → Coins → Earnings | Earned, claimable, by post; then the Wallet tab's staking card, read from Monad's staking precompile | "Creators see what they earned, read from the chain." |
| 11 | 2:50–3:00 | The repo tab | README with the live evidence | "Open source, tested, live on Monad testnet." |

## Fallbacks
- **The faucet says wait** (it allows 3 drips per wallet per 10 minutes and 6 per IP per hour): use another tab with a fresh wallet. Or show the earlier receipt card for tx `0x25238c32…7e96` (`https://juno-api-production-04ea.up.railway.app/api/juno/tx/card?hash=0x25238c32a06aa6fe7d6d3acd280570593fc2a6a38171a350e16c45e7e7be7e96`).
- **No Touch ID or PRF:** skip the passkey prompt and say it over step 4's profile preview ("one tap, no seed phrase"). The device key from step 3 carries on.
- **"Final" shows "—":** the live socket is warming. Wait 2 s. The landing in step 1 wakes it.
- **A photo upload stalls:** skip step 5. Launching is also shown in the README.
- **The Perpl open is refused** (its price limit is 1% from the mark): tap Long again. The mark moves every few seconds.

## What the run spends (Monad testnet)
About **0.5–1 MON** from Juno's hosted faucet (`0x8AeE…B0df`, ≈17 MON), as drips to the recording wallets:
- buys: 0.1 MON plus about 0.03 gas each;
- launch gas: about 0.2;
- Perpl: approval, deposit, open and close at about 0.03 each;
- passkey proof: free (an `eth_call`).

Plus **10,000 AUSD** from Agora's free faucet. No USDC, and nothing from the deployer.
