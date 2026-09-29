# Demo film

The film keeps the layout approved for the STOCKLANA and Arbitrum films (dark
stage, the phone alternating sides over a lime disc, typed titles, word-lit
captions, music about 12 dB under the voice). Everything on screen is to be
real: the phone chapters are recordings of the Expo web build at iPhone size
against Juno's **Monad testnet** deployment, c09 is an iOS Simulator
recording of a real Privy sign-in, and c10 is the verified launchpad on
MonadVision. The narration says it is testnet with no real money, and the
recorder refuses a server on a local fork, whose receipts say "a local fork".

**Nothing has been recorded.** The deployment the takes need does not exist
yet ([PLAN.md](../PLAN.md), Phase 7, blocked on MON for the deployer), and
there is no hosted app, so the takes run against the web build on this
machine. This page and `scripts/demo/` are the plan and the tooling for when
it does.

Metropolis limits ([METROPOLIS.md](METROPOLIS.md)): the **technical demo is at
most 3 minutes** — this film; `build_hf.py` prints the total and warns past
180 s. Estimated from the Arbitrum film's measured speech rate: 2:44 with c09,
2:33 without; a take that runs long adds to that (step 1 trims them). The
**founder pitch is at most 2 minutes** — a person on camera, not this
pipeline; its script is [below](#founder-pitch-2-minutes).

## Chapters

| Chapter | Kind | Shows | Take | Needs first |
|---|---|---|---|---|
| intro / problem | cards | the feed on a phone flying in; the problem | `stills` | **BLOCKED**: testnet deployment, with posts in the feed |
| c01 Every post is a market | phone | the landing's "Monad testnet · no real money", the feed, a reel with its market dock | `01-feed` | **BLOCKED**: deployment; posts and reels in the feed |
| c02 A buy that lands mid-scroll | phone | Buy on a feed card → the sheet → "Bought … — confirmed on Monad in *N*s", the tx and "View the transaction" on MonadVision | `02-buy` | **BLOCKED**: deployment; the film wallet funded |
| c03 Launch a post in one transaction | phone | + → Post a photo → photo, name, ticker, curve, a 1 MON first buy → the launch log (IPFS pins, "Market opened on Monad" with its tx and time, "Listed on Juno") → the coin page | `03-launch` | **BLOCKED**: deployment; film wallet; `PINATA_JWT` on the API; `JUNO_FILM_PHOTO` |
| c04 Creators get paid | phone | the fees card on the film wallet's own coin → Claim → "Claimed — view the transaction" | `04-claim` | **BLOCKED**: deployment; c03's coin traded by another wallet first, so there is something to claim |
| c05 Get exactly | phone | Buy → the token chip switched to "get exactly" → 100,000 tokens → "Costs … · at most …" → the receipt | `05-exact` | **BLOCKED**: deployment; `JUNO_FILM_COIN` |
| c06 Graduation into Uniswap v2 | phone | a full curve → Graduate → "Graduated" and the pair link → Buy, "Fills against …'s Uniswap v2 pair" → the receipt | `06-graduated-v2` | **BLOCKED**: deployment with `JUNO_SWAP_ROUTER`; `JUNO_FILM_GRADUATED_V2` |
| c07 Graduation into Kuru | phone | Open on Kuru → "On Kuru", bid, ask and spread → Buy on the book → the receipt | `07-kuru` | **BLOCKED**: deployment with `JUNO_KURU_GRADUATOR`; `JUNO_FILM_GRADUATED_KURU` |
| c08 Pre-IPO, marked against Tessera | phone | Trade → Pre-IPO (OpenAI, Kalshi, SpaceX and their marks) → a tracker's reference card → the sheet's band warning; nothing signed | `08-preipo`, `08-tracker` | **BLOCKED**: deployment; `JUNO_FILM_TRACKER`, outside its band when recorded |
| c09 Sign in with Privy | phone (Simulator) | the email sheet → a six-digit code → the embedded wallet on Profile | by hand | **BLOCKED**: the Monad bundle id allowed in the Privy dashboard (PLAN.md 4.2) and a person with a real email. Left out of the cut until recorded |
| c10 Verified, end to end | browser | the launchpad's verified source on MonadVision | `10-explorer` | **BLOCKED**: `contracts/deploy.sh testnet`, with verification |
| stack / outro | cards | how it's built; the end card | — | the repo link only after `scripts/publish-github.sh`; an app link only once hosted |

Not in this cut: Perps (Perpl's order path is proven by simulation only —
testnet AUSD is not mintable), the Pyth stock trackers (their marks are stale
without `PYTH_API_KEY`), Kuru limit orders, likes, comments and the portfolio.
The finality dots on the receipt follow Monad's own stream, which the test
plan has not yet seen fill on testnet; if they fill they will be in c02's
take, but the narration does not mention them.

## Before recording

1. **Deploy and verify** — `contracts/deploy.sh testnet` (PLAN.md 7.1–7.2).
   The record lands in `contracts/deployments/10143.json`, which c10 reads.
2. **Run the stack against testnet**, not the fork: without the fork override
   in `.env.development.local`, with the deployment's addresses (and
   `JUNO_SWAP_ROUTER`, `JUNO_KURU_GRADUATOR`, `PINATA_JWT`) in `.env.local`.
   ```bash
   npm run dev -- --port 3100
   cd juno-expo && EXPO_PUBLIC_API_URL=http://localhost:3100 npx expo start --web --port 8181
   curl -s localhost:3100/api/juno/config    # "network":"monad-testnet", "localFork":false
   ```
   `JUNO_APP_URL` and `JUNO_API_URL` point the scripts elsewhere once the app
   is hosted.
3. **Content.** A feed nobody has posted to reads as broken.
   `npm run juno:demo -- --round all` (about 12 MON) launches the demo posts,
   reels, trackers and two lifecycle coins from named `demo_` wallets. Their
   trades are demo trades: the narration never calls them organic, and the
   submission says they exist (the rules disqualify fake volume).
4. **The film wallet** — a testnet key the takes sign with, in the gitignored
   `.juno/film/`. The recorder puts it where the web app keeps its device key,
   prints its address and balance, and never prints the key.
   ```bash
   mkdir -p .juno/film && node -e 'console.log(require("viem/accounts").generatePrivateKey())' > .juno/film/wallet.key && chmod 600 .juno/film/wallet.key
   ```
   Fund it with about 12 MON (faucet.monad.xyz): enough for every take, and
   above the 10 MON under which Monad may revert a MON-sending transaction
   that follows another within three blocks (JUNO.md, *Monad specifics*).
5. **The coins**, as environment variables (or `--coin=0x…` style flags):
   | Variable | For | What |
   |---|---|---|
   | `JUNO_FILM_COIN` | c02 (optional), c05 | a post still on its curve, in the feed — e.g. a demo photo post |
   | `JUNO_FILM_PHOTO` | c03 | the image file the launch posts |
   | `JUNO_FILM_OWN_COIN` | c04 | a coin the film wallet launched; defaults to c03's, from `.juno/video/raw/takes.json`. Trade it from another wallet first: `npm run juno:trade -- --token 0x… --amount 1 --yes` |
   | `JUNO_FILM_GRADUATED_V2` | c06, the hero still | a full curve (graduated on camera) or a graduated one. Full: launch a small one with `npm run juno:launch -- … --initial 0.1 --migration 2.5 --yes`, then `npm run juno:trade -- --token 0x… --fill --yes`. Graduated: the demo's `GRADV2` |
   | `JUNO_FILM_GRADUATED_KURU` | c07 | the same with `--venue kuru --initial 0.5 --migration 12.5`, or the demo's `GRADKURU` |
   | `JUNO_FILM_TRACKER` | c08 | a Pre-IPO tracker, e.g. the demo's `OPENAIX`, outside its band when recorded |
   | `JUNO_FILM_LAUNCHPAD` | c10 | only to override the deployment record |

   Sizes: `JUNO_FILM_BUY` (MON, default 0.5), `JUNO_FILM_EXACT` (tokens,
   default 100000), `JUNO_FILM_FIRST_BUY` (0, 1, 5 or 10 MON; default 1),
   `JUNO_FILM_TRACKER_BUY` (default 1); the post's `JUNO_FILM_NAME`,
   `JUNO_FILM_TICKER`, `JUNO_FILM_CAPTION`. The end card:
   `JUNO_FILM_REPO_LINK` (default `github.com/nickthelegend/juno-monad`),
   `JUNO_FILM_APP_LINK` (none by default).
6. **Playwright**, which this repo does not depend on:
   `npm i --no-save playwright`. The recorder uses the chrome-headless-shell
   the Arbitrum film used if it is in Playwright's cache, else Playwright's
   own (`npx playwright install --only-shell chromium`), else `JUNO_CHROMIUM`.
   Reels are H.264, which that build may not play; if the reel in c01's
   take stays black, record c01 from the Simulator instead, the way c09 is
   recorded.

A practice run on the local fork is `--rehearse`; its footage says "local
fork" and is not for the film.

## Build

```bash
# 0. the HyperFrames project, once: the Arbitrum film's config, fonts and music bed
ARB="/Volumes/Extreme SSD/Projects/juno-arbitrum/.juno/video/final/hf"
HF=.juno/video/final/hf
mkdir -p .juno/video/raw .juno/video/final/vo $HF/assets/clips $HF/assets/audio $HF/fonts
cp "$ARB/hyperframes.json" $HF/ && cp "$ARB"/fonts/* $HF/fonts/
cp "$ARB/assets/audio/music-bed.wav" $HF/assets/audio/   # 204 s; or music_eleven.py / music.py
python3 scripts/demo/device_frame.py $HF/assets/phone-frame.png

# 1. footage (the web app on :8181 and the API on :3100, both on testnet)
node scripts/demo/record-web.mjs .juno/video/raw          # c01–c08, c10 and the stills; or a list: c02,c05
cp .juno/video/raw/stills/*.png $HF/assets/               # hero-screen, card-preipo, card-graduated
#    cut the waits (upload, confirmation) out of a long take, e.g. the launch:
python3 scripts/demo/tighten.py .juno/video/raw/03-launch.mp4 .juno/video/raw/03-launch.tight.mp4 --hold 1.2
mv .juno/video/raw/03-launch.tight.mp4 .juno/video/raw/03-launch.mp4
#    c09, only with a real Privy login, on the iOS release build (PLAN.md 5.1):
#    xcrun simctl io booted recordVideo --codec=h264 .juno/video/raw/09-privy.mov  (Ctrl-C to stop), then
#    ffmpeg -i .juno/video/raw/09-privy.mov -r 30 -c:v libx264 -crf 16 -pix_fmt yuv420p .juno/video/raw/09-privy.mp4

# 2. voice + word timings for the captions
python3 scripts/demo/vo_local.py .juno/video/final/vo     # Kokoro + hyperframes transcribe, no key
#    or, with a key: ELEVENLABS_API_KEY=… python3 scripts/demo/vo_eleven.py .juno/video/final/vo
#    (it writes .mp3: convert each to .wav under the same name)
for f in .juno/video/final/vo/*.wav; do cp "$f" $HF/assets/audio/vo-$(basename "$f"); done

# 3. clips, composition, render, final mix
python3 scripts/demo/clips.py $HF .juno/video/final/vo    # leaves c09 out when there is no footage
python3 scripts/demo/build_hf.py $HF .juno/video/final/vo # prints the total; warns past 180 s
(cd $HF && npx --yes hyperframes@0.8.86 check && npx --yes hyperframes@0.8.86 render -o ../film-render.mp4)
python3 scripts/demo/remix.py $HF .juno/video/final/film-render.mp4 juno-monad-film.mp4
```

`node scripts/demo/e2e-ui.mjs` runs the visitor flows (test plan A, D, E, F,
G) against the same app and coins and prints a JSON report: worth a run
before recording.

Before rendering, check that every line below is still true on the day, that
the stack card's counts match `forge test`, the Kuru fork suite and
`npm run test:unit` (`build_hf.py`, `stats`), and that the end card's links
resolve. Listen back for Kokoro's "Pre-IPO", "MonadVision" and "Kalshi"; a
respelling in `vo.py` also changes the caption.

## Narration

The text lives in `scripts/demo/vo.py` (`LINES`), which both voice scripts
read; this is a copy. Every sentence is something JUNO.md or PLAN.md records
as built and checked. c09 and c10 become true only with a recorded login and
a verified deployment, and are cut until then.

| Id | Line |
|---|---|
| intro | This is Juno, on Monad testnet, with no real money. Every post is a market. |
| problem | Creators get paid by platforms, months later, in ad money. Their first fans get nothing. On Juno, every post is its own market, and its creator earns on every trade. |
| c01 | Every photo and reel on Juno is its own token, on its own bonding curve. The feed and the reels show each market's value, and how close it is to graduating. |
| c02 | A buy happens mid-scroll. The server builds the transaction, the wallet in the app signs it, and the server waits for the receipt. The sheet shows how long that took, and links it on MonadVision. |
| c03 | Posting is launching. Pick a photo, name it, pick a curve shape. One transaction deploys the token, opens its curve and makes the creator's first buy, and the launch log shows each receipt. |
| c04 | Every trade pays a fee, and most of it builds up for the creator. Only the creator gets the Claim button, and one transaction pays it out. |
| c05 | The token chip switches a buy from spend to get exactly. The contract delivers exactly that many tokens, never above the stated cost, and refunds the rest. |
| c06 | When a curve fills, anyone can graduate it. Its reserves move into the coin's Uniswap v2 pair at the curve's final price, locked for good, and Juno keeps trading it there through its own router. |
| c07 | Or the creator picks Kuru. Graduation then opens the coin's own market on Kuru's order book, seeds its vault at the curve's final price, and trading carries on there. |
| c08 | The same curves make Pre-IPO trackers for OpenAI, Kalshi and SpaceX, marked against Tessera. When a curve drifts outside its band, the trade sheet says so before anything is signed. |
| c09 | On a phone, sign-in can be Privy. An email and a six-digit code make an embedded wallet, and it signs the same server-built transactions. |
| c10 | Every contract is verified on MonadVision, and every step you saw is a real transaction on Monad testnet. |
| stack | Under the hood, one Expo app runs on iOS, Android and the web. The server builds every transaction, and the wallet signs it. Juno's own Solidity contracts run the curves and graduation, and Envio indexes the history. |
| outro | Juno. Every post is a market. Built on Monad. |

What the lines rest on: the band warning is the trade sheet's (PLAN.md 1.3),
not the contract's — Juno's contracts read no oracle, so no line says the
contract refuses anything. Creators get "most" of each fee because the
protocol's share is 20% by default and fixed per pool at launch. Kuru
graduation is testnet-only (Kuru's mainnet router lets only Kuru create
markets), which c07's card says.

## Founder pitch (≤ 2 minutes)

About 260 words: 1:43 at 150 words a minute, 1:51 at 140. A person to camera; cut to the
film's chapters where marked. Say only what is true on the day: once the
deployment and the hosted app exist, name them; if the Privy login is still
unrecorded, say Privy is built in, not that you can sign in with it.

> **[0:00 — to camera]** I'm [name], and this is Juno. On Juno, every post is
> a market. Post a photo or a reel, and it launches its own token on a
> bonding curve on Monad. It runs on Monad testnet today, so nothing you'll
> see is real money.
>
> **[0:15]** Creators are paid by platforms, months later, out of ad money,
> and the people who found them first get nothing for it. Curation is
> valuable, and nobody pays for it.
>
> **[0:30 — cut to c01, then c04]** On Juno, buying a post is the curation
> signal, and it pays. Every trade pays a fee, and most of it goes to the
> creator. The fans who found a post early bought in at the price they found
> it at.
>
> **[0:50 — cut to c06, c07]** When a curve fills, it graduates into a
> Uniswap v2 pair, or into its own market on Kuru's order book, with the
> liquidity locked for good, so the market outlives the app. The same curves
> track pre-IPO companies like OpenAI and SpaceX, marked against Tessera.
>
> **[1:10 — cut to c02]** It has to feel like scrolling. On Monad, the server
> sends each trade and gets the receipt back in the same call, and the app
> shows how long it took. A launch is one transaction, cheap enough to price
> a single post.
>
> **[1:20 — to camera]** What's built: Juno's own contracts, with
> seventy-four Foundry tests, fuzzed invariants among them; one Expo app on
> iOS, Android and the web; Privy embedded wallets; and an Envio indexer for
> the full history.
>
> **[1:35]** That's Track 03: a feed where curation is paid for by the people
> who benefit from it. Juno. Every post is a market.
