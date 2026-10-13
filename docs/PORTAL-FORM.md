# Portal form: hackathon.monad.xyz → "Complete your entry"

Fields are in the portal's order, each within its limit. Paste each block as it is.
Video fields need links: upload the mp4s to YouTube or Loom (unlisted is fine) and paste the links.

---

## 1. Primary track
Track 01: Onchain Finance & Trading

## 2. Logo
`docs/brand/logo-portal.png` (1000×1000 PNG, 24 KB)

## 3. Project name (≤ 120)
Juno

## 4. Tagline (≤ 200)
Every post is a market: post a photo or reel and it launches its own coin on Monad. Fans buy in as they scroll, creators earn the fees, and a full curve opens its own Kuru order book.

## 5. Description (≤ 8,000)
**PROBLEM**
Creators make the posts everyone scrolls past, but the platform keeps the money, and the fans who found a creator early get nothing for it. Creator coins exist, but they die on their bonding curve: there is nowhere for a winning post's market to go.

**SOLUTION**
On Juno every post is a market. Publishing a photo or reel is one Monad transaction: the token, a bonding curve shaped for the post, and the lock on its future liquidity. People buy into posts straight from the feed, and the creator earns the trading fees, which the profile adds up from the chain. When a curve fills, the coin graduates into **its own Kuru order book**, seeded from its raise with the liquidity locked, so the market outlives the app.

The same wallet also trades:
- **Perpl** perps, with **Agora AUSD** margin;
- **pre-IPO trackers** (OpenAI, Kalshi, SpaceX), whose NAV is attested on Monad by a **Chainlink CRE** workflow.

You sign in with one **Mera** passkey, and an **Envio** indexer keeps the history.

**WHY MONAD**
The receipt is the product moment. A buy through the live app executed in **416 ms** and was **final in 579 ms**, on 295 ms blocks. The server measures this around `eth_sendRawTransactionSync` and Monad's commit stream. Juno also:
- shows Monad's blocks moving Proposed → Voted → Finalized → Verified (`monadNewHeads`);
- checks passkeys with Monad's P256 precompile;
- reads native staking from Monad's precompile;
- reports txpool status;
- follows Monad's gas-limit billing and its 10 MON reserve rule.
Trading at the speed of a feed only works on a chain this fast.

**WHAT'S LIVE (Monad testnet)**
- App: https://juno-monad-app.vercel.app, with an API and an Envio indexer hosted on Railway.
- Contracts, all verified on MonadVision: `JunoLaunchpad`, `KuruGraduator`, `UniswapV2Graduator`, `JunoSwapRouter`, `JunoNavOracle`.
- Testnet proof:
  - a Kuru graduation and trades on its new book;
  - a Perpl 2x long opened and closed with AUSD margin;
  - a Chainlink CRE NAV attestation;
  - a passkey (Mera) account buying.
  Every hash is in the repo's `docs/evidence/`.
- **The activity on testnet is team-seeded:** the `demo_` creators and four more team wallets, labelled as such in `docs/evidence/seed-13oct.md`. There are no outside users yet.

## 6. First users, and how we reach them (≤ 8,000)
**First users**
- Creators who already post photos and short video and want a direct cut of the attention they earn: photographers, street and travel creators, small artists. Juno pays them the trading fees on every post, read from the chain.
- Their early fans and crypto-native collectors, who want a stake in a creator before they're big. On Juno, buying in costs one tap, and a post that succeeds ends on a real order book, not a dead curve.

**How we reach them**
1. Creators already on Monad and Kuru communities. Every graduation opens a new Kuru market, so Kuru's traders see Juno coins as new assets.
2. Share cards built in: every trade receipt and every coin produces a 1200×630 image to post on X, which brings each buyer's followers back to the post.
3. One-tap onboarding: a passkey account with no seed phrase, and testnet MON from the faucet inside the buy sheet. A creator's audience can follow a link and buy in under a minute.
4. Creator onboarding: seed the first 50 creators with launch guidance, then use their earnings pages as proof for the next wave.
5. Mainnet: launch with Kuru market creation access, and ship the iOS and Android builds from the same Expo codebase to the stores.

## 7. Repo URL
https://github.com/nickthelegend/juno-monad

## 8. Live app URL
https://juno-monad-app.vercel.app

## 9. Demo video (≤ 3:00)
**Pending.** The full-flow recording waits on the owner's call about how to record it (see the session report). The current cut is `docs/demo/juno-metropolis.mp4` (2:21, live on testnet, but it opens with a 35 s motion-graphics intro, which this field's rules exclude). Upload the final file and paste its link.

## 10. Pitch video (≤ 2:00)
`docs/demo/juno-pitch.mp4` (1:22, kinetic type in Juno's palette with one live glimpse; captions in `juno-pitch.srt`). Upload it and paste the link.
Team: [user fills in]

## 11. Testing instructions for judges (≤ 8,000)
**No login needed.** It runs on Monad testnet (chain 10143), with no real money. Use any desktop or phone browser.

1. Open https://juno-monad-app.vercel.app. The landing shows Monad testnet's live blocks moving Proposed → Voted → Finalized → Verified.
2. **Get Started** opens the feed: every post is a market. On a laptop, the side rails show live Monad activity and the most traded coins.
3. **Buy** on any post → **Create a wallet to trade** → **Get testnet MON** (0.5 MON from Juno's faucet, in the sheet) → pick a size → **Buy**. The receipt shows **Executed** and **Final** in ms, and what it cost against the same gas on Ethereum. **Share this receipt** makes the image card.
4. **Profile** → **Create a passkey account**: one passkey prompt makes a Mera account. Then Wallet → **Prove my passkey on Monad**, checked by Monad's P256 precompile. This needs a browser with passkey PRF support, e.g. Chrome on a Mac with Touch ID.
5. Search (the magnifier) → `gradk` → **$GRADKURU**: a post that graduated into its own **Kuru** order book. Note the *Order book on Kuru* badge, the bid and ask, Activity rows tagged KURU, and **Limit order**.
6. **Trade → Perps** → **Get 10,000 test AUSD** (Agora) → **Open account** → BTC → 2x long → open → **Close**. **Risk** shows funding, premium and distance to liquidation, live from Perpl's API.
7. Search → `openai` → **$OPENAIX**: *NAV $… · attested by Chainlink CRE*.
8. **+** → Post a photo → name and ticker → **Launch post**: one transaction makes a new market.

**Notes and limits**
- The faucet allows 3 drips per wallet per 10 minutes and 6 per IP per hour. If it says wait, use a fresh wallet.
- Activity on testnet is team-seeded (the `demo_` wallets and four labelled team wallets).
- Privy sign-in on the hosted site needs the owner's dashboard settings. Use the passkey or the device key instead.
- The proof hashes are in the repo: `docs/evidence/testnet-13oct.md` and `docs/evidence/seed-13oct.md`.

## 12. Bounties
**Kuru: Bring New Assets and Markets.** Every Kuru-venue post graduates into its own new Kuru market through v1 `Router.deployProxy`, seeded from the curve's raise and reserved supply at the final price, vault shares burned.
- Issuance: the post's curve.
- Settlement: Kuru's book.
- Onboarding: the social feed.
- Proof: graduation [`0x04de4115…5bda`](https://testnet.monadvision.com/tx/0x04de4115b0a993676289c9c94b98f9d96f5927c5ea56d1262312dce5ef715bda), market `0xD2175fd455bb91d631c9ca95E69902fED171a144`.

**Kuru: Next Consumer Trading App.** After graduation, every trade in the app routes through the coin's Kuru book: market buys and sells from the feed, limit orders, cancel and withdraw. Fills are recorded from receipts.
- *Target users:* people who spend attention on posts and reels and want a stake in what they like, and the creators paid the fees.
- *Evidence of demand:* creator coins and bonding-curve launches (Zora, pump.fun) are among crypto's most used consumer products.
- *Retention plan:* a feed of new posts, a live tape, price alerts, watchlists, and recurring buy plans run by autopilot.
- *Continuation plan:* Kuru mainnet with market-creation access, and the native apps in the stores.
- Proof: buy [`0xe68f8fff…65d6`](https://testnet.monadvision.com/tx/0xe68f8fff7035bd65adf7699621e7b88be3e015731e0082034c66e08355f665d6), sell [`0x2c58097c…7058`](https://testnet.monadvision.com/tx/0x2c58097c9843ae74dda6cb2da3e97d95ade00c6ffe7ca27d553c02eb127b7058).

**Perpl: Analytics / Risk Tool.** Perps → Risk, live from Perpl's API.
- Per market: funding now and annualised, the last day's cost to a $1,000 long, premium to the oracle, volatility.
- Per position: leverage, distance to liquidation, margin against maintenance, the effect of a 10% adverse move.
- Proof: 2x BTC long [`0x3f81ae5a…864b`](https://testnet.monadvision.com/tx/0x3f81ae5afaf036f4b38b1e94f4b9bccc10fad402db8b735afa613088b011864b), then closed.

**Perpl: Best use of the API.** `npm run juno:perpl-bot`, a funding-carry and position-guard bot on Perpl's public API and `execOrder`. It has caps, a daily loss limit, a kill switch and a mainnet refusal, and its state survives restarts.

**Agora: Best Mobile Trading App.** One Expo codebase (`juno-expo/`) for iOS, Android and web, trading Perpl perps with AUSD margin, with an in-app Agora AUSD faucet and a Mera passkey sign-in. The live web build runs in a phone browser. Native builds come from source (README, *Install it*); there is no store listing. Proof: AUSD [`0x6bd741fb…dd84`](https://testnet.monadvision.com/tx/0x6bd741fb729021b61fc37a41eb3e7d3188a8bf787e4a3258f857ff12ae92dd84).

**Mera: Best UX / One Passkey, Many Keys.**
- One passkey prompt makes the account (Mera derives an ordinary Monad key from the passkey's PRF output, so the account is a plain EOA), with 15-minute signing sessions.
- Sealed drafts: post text encrypted under a second PRF salt.
- Profile → Wallet → "Prove my passkey on Monad" sends the passkey's WebAuthn signature to Monad's P256 precompile (`0x0100`) with an `eth_call`, the same check a contract would make. It is a read, so it has no tx hash; the profile then shows "Passkey verified on Monad".
- Proof: a buy signed by a passkey session, [`0xdaddc274…ac96`](https://testnet.monadvision.com/tx/0xdaddc274487914411eaea54d8792297482d0eefdd77d7d85d5e5be73b15aac96).

**Chainlink: Best workflow with CRE.** `cre/juno-nav`: a cron-triggered workflow reads Tessera over HTTP with consensus, plus Pyth, the USDC/USD Data Feed and the launchpad. It writes NAV and the premium to `JunoNavOracle`, and coin pages show the badge. It ran with the CRE CLI's `cre workflow simulate --broadcast`, which delivers a real report through Monad testnet's MockKeystoneForwarder. It is not deployed to a live DON, which needs CRE deploy access. Proof: report [`0xc777646c…2b10`](https://testnet.monadvision.com/tx/0xc777646ce8fee4d90e5da2fa2244b8ea84ddde8e40bb02b914f0e0ea0abb2b10); `JunoNavOracle.navOf(token)` returns it.

**Envio: Best Use of Envio.** HyperIndex v3 over five contracts, with dynamic registration, positions with cost basis, holders and open Kuru orders. Hosted on Railway behind Juno's API. Check it: `GET https://juno-api-production-04ea.up.railway.app/api/juno/coins/0x2DA4841d9694Ae7Ac6D609D824EbD9A1FBf96754` returns `holdersSource: "indexer"` and `indexer: { progressBlock, behind }`.

**Also integrated, not claimed:** Privy. Embedded wallets sign every launch and trade, and autopilot runs plans through per-wallet Privy policies and a server key-quorum signer. The hosted app's Privy sign-in waits on the owner's dashboard settings.

## 13. Optional promo clip (≤ 0:30)
Not made yet: it waits on the demo recording. It will be at `docs/demo/juno-promo.mp4`.

## 14. X link
[user fills in]
