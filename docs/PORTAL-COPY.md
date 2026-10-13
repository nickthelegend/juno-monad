# Portal copy (hackathon.monad.xyz): paste-ready

## Project name
Juno

## Tagline (≤ 80)
Every post is a market: creator coins that graduate into their own Kuru book.

## Short description (≤ 280)
Post a photo or reel and it launches its own bonding curve on Monad in one transaction. Fans buy in as they scroll, and creators earn the fees. A filled curve opens its own Kuru order book. Perpl perps with Agora AUSD margin, and CRE-attested pre-IPO trackers.

## Full description
**Problem.** Creator coins die on their curve. Attention is the product, but creators don't own it, and the fans who spot them first get nothing for it.

**Solution.** On Juno every post is a market. Publishing a photo or reel is one Monad transaction: the token, a bonding curve shaped for the post, and the lock on its future liquidity. People buy into posts from the feed, and the creator earns the trading fees. When a curve fills, the coin graduates into **its own Kuru order book**, seeded from the raise with the liquidity locked, so the market outlives the app. The same wallet trades **Perpl** perps with **Agora AUSD** margin, and **pre-IPO trackers** (OpenAI, Kalshi, SpaceX) whose NAV is attested on Monad by a **Chainlink CRE** workflow. You sign in with one **Mera** passkey, or Privy.

**Why Monad.** The receipt is the product moment. A buy through the live app executed in **416 ms** and was **final in 579 ms**, on 295 ms blocks, measured by Juno's server around `eth_sendRawTransactionSync` (`lib/juno/tx.ts`, `submitSigned`; the browser posts the signed bytes to `/api/juno/tx/submit`) and Monad's commit stream. Juno shows Monad's blocks moving Proposed → Voted → Finalized → Verified (`monadNewHeads`), checks passkeys with Monad's P256 precompile, reads native staking, reports txpool status, and follows Monad's gas-limit billing and 10 MON reserve rule.

**What's live.** <https://juno-monad-app.vercel.app> on Monad testnet:
- 15 markets;
- verified contracts;
- a hosted API and Envio indexer;
- 7 sponsor integrations, each proven with a testnet transaction (`docs/SPONSOR-COVERAGE.md`).

## Track
Track 01: Onchain Finance & Trading.

## Bounties claimed

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

**Chainlink: Best workflow with CRE.** `cre/juno-nav`: a cron-triggered workflow reads Tessera over HTTP with consensus, plus Pyth on Monad and the launchpad, and Chainlink's USDC/USD Data Feed for USDC-quoted trackers. The 13 Oct report's three trackers are MON-quoted, so that run priced them with Pyth's MON/USD. It writes NAV and the premium to `JunoNavOracle`, and coin pages show the badge. It ran with the CRE CLI's `cre workflow simulate --broadcast`, which delivers a real report through Monad testnet's MockKeystoneForwarder. It is not deployed to a live DON, which needs CRE deploy access. Proof: report [`0xc777646c…2b10`](https://testnet.monadvision.com/tx/0xc777646ce8fee4d90e5da2fa2244b8ea84ddde8e40bb02b914f0e0ea0abb2b10); `JunoNavOracle.navOf(token)` returns it.

**Envio: Best Use of Envio.** HyperIndex v3 over five contracts, with dynamic registration, positions with cost basis, holders and open Kuru orders. Hosted on Railway behind Juno's API. Check it: `GET https://juno-api-production-04ea.up.railway.app/api/juno/coins/0x2DA4841d9694Ae7Ac6D609D824EbD9A1FBf96754` returns `holdersSource: "indexer"` and `indexer: { progressBlock, behind }`.

**Also integrated, not claimed:** Privy. Embedded wallets sign every launch and trade, and autopilot runs plans through per-wallet Privy policies and a server key-quorum signer. The hosted app's Privy sign-in waits on the owner's dashboard settings.

## Bounty article links
One per bounty, for the portal's required field "Published article describing how <sponsor> was used and what value it brought".

- Kuru (New Assets & Markets; Consumer Trading App): https://github.com/nickthelegend/juno-monad/blob/main/docs/KURU.md
- Perpl (Analytics / Risk; Best use of the API): https://github.com/nickthelegend/juno-monad/blob/main/docs/PERPL.md
- Agora (Best Mobile Trading App): https://github.com/nickthelegend/juno-monad/blob/main/docs/AGORA.md
- Mera (Best UX; One Passkey, Many Keys): https://github.com/nickthelegend/juno-monad/blob/main/docs/MERA.md
- Chainlink (Best workflow with CRE): https://github.com/nickthelegend/juno-monad/blob/main/docs/CHAINLINK-CRE.md
- Envio (Best Use of Envio): https://github.com/nickthelegend/juno-monad/blob/main/docs/ENVIO.md

## Links
- Demo video (2:21): `docs/demo/juno-metropolis.mp4` in the repo (captions: `docs/demo/juno-metropolis.srt`). Upload it to YouTube and paste that link here.
- Repo: <https://github.com/nickthelegend/juno-monad> (MIT)
- Live app: <https://juno-monad-app.vercel.app>
- API: <https://juno-api-production-04ea.up.railway.app>
- Contracts, verified on MonadVision:
  - `JunoLaunchpad`: [`0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81`](https://testnet.monadvision.com/address/0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81)
  - `KuruGraduator`: [`0xBeFD5740896D157A3E9821939e5ba213BEf50F99`](https://testnet.monadvision.com/address/0xBeFD5740896D157A3E9821939e5ba213BEf50F99)
  - `UniswapV2Graduator`: [`0x6924937d7DDDD7D1c931Dc7a9779bD32F807FeAA`](https://testnet.monadvision.com/address/0x6924937d7DDDD7D1c931Dc7a9779bD32F807FeAA)
  - `JunoSwapRouter`: [`0x648c6E84F779Cf20730Db26d49B7B950ca256366`](https://testnet.monadvision.com/address/0x648c6E84F779Cf20730Db26d49B7B950ca256366)
  - `JunoNavOracle`: [`0x2DF370b26CaDBCf94Df3e6766B9f7D91Bf36DC9f`](https://testnet.monadvision.com/address/0x2DF370b26CaDBCf94Df3e6766B9f7D91Bf36DC9f)
- The 3 best transactions:
  1. A live buy, executed in 416 ms and final in 579 ms: [`0x25238c32…7e96`](https://testnet.monadvision.com/tx/0x25238c32a06aa6fe7d6d3acd280570593fc2a6a38171a350e16c45e7e7be7e96)
  2. A post graduating into its own Kuru market: [`0x04de4115…5bda`](https://testnet.monadvision.com/tx/0x04de4115b0a993676289c9c94b98f9d96f5927c5ea56d1262312dce5ef715bda)
  3. A Chainlink CRE NAV attestation: [`0xc777646c…2b10`](https://testnet.monadvision.com/tx/0xc777646ce8fee4d90e5da2fa2244b8ea84ddde8e40bb02b914f0e0ea0abb2b10)

## Team and attribution
- Built by nickthelegend.
- Demo media is free-licence Pexels footage.
- Pre-IPO marks come from Tessera's public API, and prices from Pyth.

## AI tools disclosure
Built with Anthropic's Claude (Claude Code) as a coding agent: implementation, tests, docs and e2e harnesses, under the author's direction and review. The product makes no AI calls. The optional `mm juno ask` (Kimi) is not configured in this deployment.
