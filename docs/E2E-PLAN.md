# Juno on Monad — end-to-end plan (fourth pass, 2026-09-29)

Every screen, every API method, every on-chain interaction and every external
integration, with what **correct** means for each. This is the checklist the
run is measured against; `Status` is filled in as each item is run.

## Rules

- **Harness.** The web app (Expo web on `http://localhost:3000`, the origin the
  Privy web app allows) in Chrome, driven with Claude in Chrome, at phone width.
  API on `:3100`, Envio on `:8080`, MongoDB and Postgres local.
- **Chain.** Monad testnet's deployer holds 0 MON (checked 29 Sep), so Juno is
  not on testnet. On-chain items run on a local anvil fork of Monad testnet:
  Juno's real contracts deployed there, Kuru, Perpl, Pyth, USDC and WMON as the
  real testnet contracts forked, every transaction a real signed transaction
  that the fork executes. An item that only real testnet can prove is marked
  **UNTESTED (testnet)**, never PASS.
- **PASS** means the result matches the definition exactly, the console has no
  error and no warning from the app, and no request in the flow fails or
  answers 4xx/5xx unless the item is *about* that answer. Anything else is
  **FAIL**, fixed at its cause, and run again from the start.
- **Cross-checks.** Where the app shows an on-chain number, the item compares
  it with the chain (`cast`) or the API's raw answer, not with itself.
- **UNTESTED** is for a dependency that does not exist here: a person's Privy
  login, real testnet MON, a Pyth API key. It is never counted as a pass.
- No mocks, stubs or fallback data anywhere in the tested surface.

## A. Shell and navigation

| ID | Item | Correct means | Status |
|---|---|---|---|
| A1 | Landing | `/` renders the badge, headline, copy and Get Started; `GET config` 200 with `chainId` 10143, the launchpad address, `localFork: true`; the badge reads "Monad testnet (local fork) · no real money" | FAIL → fixed → PASS. Rendered correctly, but the console carried React Native Web deprecations (`shadow*`, `textShadow*` from the theme, HeartBurst, Reels) and 27 styled-components warnings from Privy's SDK evaluated mid-render. Fixed: web shadows as CSS, Privy preloaded in a new entry (`index.ts`, `lib/preload.web.ts`). Re-run: no warning, no error; config 200 (10143, launchpad, localFork) |
| A2 | Get Started | Lands on `/social` (the feed) | PASS — real click → /social |
| A3 | Tab bar | Feed, Trade, +, Reels, Profile each open their screen; exactly one tab is marked selected (`aria-selected`) | PASS — Social, Trade, Reels, Profile each open and are the one tab marked selected; + opens the Create sheet |
| A4 | Unknown route | `/nope` shows "Nothing here … Go to the feed", and the link goes to the feed | PASS — "Nothing here…"; Go to the feed → /social |
| A5 | Deep link reload | Reloading `/coin/<token>`, `/trader/<wallet>`, `/post/<id>` renders that screen directly, not the landing | PASS (coin, trader); post page under D9 |
| A6 | Web frame | On a 1400px window the app is a centred column ≤ 480px | PASS — 480px column centred in a 1440px window |
| A7 | API page request | `GET http://localhost:3100/coin/<token>` redirects (307) to the app's `/coin/<token>`; `/api/*` is not redirected | PASS — /coin/… on the API 307 → app; /api/juno/config 200 |

## B. Wallet and identity

| ID | Item | Correct means | Status |
|---|---|---|---|
| B1 | Create a device wallet | Profile → Create wallet shows a 0x address; a reload shows the same address; the key is in `localStorage` (`juno.monad.signer.v1`) | PASS — Create wallet → 0x0021…15Aa; same after reload; key in localStorage |
| B2 | Faucet | "Get testnet MON" → "0.5 MON received"; the balance shown rises by exactly 0.5; `eth_getBalance` on the fork agrees | PASS — "0.5 MON received"; balance 0 → 0.5; fork eth_getBalance 0.5 |
| B3 | Faucet refuses a repeat | A second request for the same wallet is refused with a sentence (rate limit), nothing sent | PASS — limit is 3 per wallet per 10 min (the plan said 1; the code's rule is the definition): sends 2 and 3 landed (1.5 MON on chain), the 4th → 429 "Too many faucet requests. Try again in 10 min." + Monad's faucet link. Found on the way: the per-address limit read the client-written first `x-forwarded-for` entry — spoofable. Fixed (`clientIp()`), and upload/metadata pinning, which had no limit, now have one; 5 unit tests |
| B4 | Faucet empty | With the faucet key at 0 MON the button answers "Juno's faucet is empty…" with the public faucet link, HTTP 503 | PASS — faucet key set to 0 on the fork: 503 "Juno's faucet is empty. Get testnet MON at https://faucet.monad.xyz…"; restored |
| B5 | Claim a name | Choose a name → EIP-191 signature → the name replaces the short address on Profile and on the wallet's posts | PASS — e2e_tester claimed by EIP-191 signature; Profile header shows it; GET profiles returns it |
| B6 | Name rules | A taken name, and a name with bad characters, are each refused with a sentence; nothing is saved | PASS — the field strips invalid characters as typed; demo_ana → "That name is taken." (400), nothing saved |
| B7 | Signer choice | Profile shows "Sign with: Device key / Privy"; choosing Privy and "Sign in with Privy" opens Privy's own modal (email, Google, X) with no console error; closing it returns to Profile | PASS — Privy → Sign in with Privy → Privy's modal (email, Google, Twitter/X), closed; no console error, Privy's frame loads on :3000; back to the device key keeps the same wallet |
| B8 | Privy login and signing | A person logs in, gets the embedded wallet, signs a buy | UNTESTED (needs a person) |
| B9 | Privy identity route | `POST /api/juno/profiles/privy` with a bad token → 401 with a sentence | PASS — 401 "That Privy session is not valid. Sign in again." |
| B10 | Copy address | Copy address puts the full address on the clipboard | PASS — the full address goes to the clipboard; "Copied" for 1.4 s |

## C. Launch (Post)

| ID | Item | Correct means | Status |
|---|---|---|---|
| C1 | Composer | + → Post a photo: photo picker, Name, Ticker, Caption, four curve presets with blurbs, venue (Uniswap v2 / Kuru), first buy (None/1/5/10 MON), quote MON/USDC; Launch disabled with a reason until valid | PASS — photo, Name, Ticker, Caption, four presets with blurbs, venue (Uniswap v2 / Kuru order book), first buy (None/1/5/10 MON), Launch with its one-transaction note. Posts launch in MON; the quote choice the plan listed is not in the composer by design (USDC is for trackers, via the API) |
| C2 | Validation | No photo, no name, a ticker with bad characters: Launch stays disabled and a sentence says which | FAIL → fixed → PASS. No photo → "Add a photo to launch", no name → "Name it to launch"; but "DAWN!" said "Add a 2–10 character ticker", which it already was. Now "Tickers are letters and digits only"; re-run after reload: all four hints correct |
| C3 | Launch a photo post | A real JPEG → upload to IPFS (Pinata), metadata pinned, one launch transaction, listing. The launch log shows each step with its CID/tx and time; the coin page opens with the photo, name, ticker, 0% progress (or the first buy's progress); the composer is blank on return | PASS — real 3000×2002 JPEG → Pinata (201, 12.4 s) → metadata (201) → tx/launch → signed → tx/submit → listing (201) → coin page with photo, name, caption, $DAWN, creator e2e_tester, 1 holder; launch log captured on C5: "Photo pinned to IPFS · QmZsvm…", "Token metadata pinned · QmSTQG…", "Market opened on a local fork of Monad" + tx + time, "Listed on Juno"; composer blank afterwards |
| C4 | First buy in the launch | With 1 MON first buy, the creator holds tokens straight after the launch; the balance equals the launch receipt's `Trade` amount | PASS — launch receipt: one tx, `Trade` 26,281.435… DAWN for 1 MON; `balanceOf` equals it to the wei; MON 1.5 → 0.4978 (1 + gas) |
| C5 | Kuru venue | Launch with Kuru chosen succeeds; Details say the Kuru market opens at graduation | PASS — Kuru selected (footnote changes to the Kuru rule); launched; Details: "Kuru market 0x8E2D…8238 · opens at graduation" |
| C6 | Reel launch | A short MP4 → upload with a poster frame → launch; the reel appears in Reels and plays | PENDING — Chrome's window is hidden (display asleep) and Chrome defers media loading there: the picker's video metadata read never resolves (tested directly: readyState 0 after 8 s). To be run in headless Chromium |
| C7 | Venue/quote rule | `POST tx/launch` with USDC quote and Kuru venue → 400 "A Kuru market is priced in MON…" | PASS — 400 "A Kuru market is priced in MON. Launch in MON to choose Kuru." |
| C8 | Preset range rule | `POST tx/launch` with tight-nav and a 5x migration cap → 400 naming the 3x limit | PASS — 400 "Tight NAV stays near-flat only up to 3x from opening to graduation; this asks for 5.0x" |
| C9 | The launch in the feed | The new post appears at the top of the feed with its photo and market cap | PASS — Falls at Dawn tops the feed with its photo, $1.00k, "Bought by e2e_tester", caption |

## D. Feed, reels, posts

| ID | Item | Correct means | Status |
|---|---|---|---|
| D1 | Feed | For you lists posts with creator, photo/poster, market cap, likes, replies, Buy (or the right label), "Bought by" from real trades, progress; no placeholder where media exists | PASS — 14 feed images all loaded (none broken), reels show poster + Reel badge, every post has Buy (graduated v2/Kuru coins included), empty state "No buyers yet — be the first in.", no NaN/undefined |
| D2 | Stories row | The reel stories ($TIDE, $SURF…) open that reel | PASS: tapping the $SURF story opens Reels at start=0x0a99…8884, which /api/juno/coins lists as SURF 'Board Check' (video); the reel shows Board Check by demo_lens, $1.00k cap, Sell/Buy dock |
| D3 | Like | Like → count +1, persists across reload; Unlike → back | PASS — Like → filled heart, 1, POST likes 200; kept after reload; Unlike → empty, kept after reload |
| D4 | Comment | Comment on a post appears in its thread and the reply count rises | FAIL → fixed → PASS. The comment posted (201), listed as e2e_tester, reply count 1, kept after reload. But Escape did not close the sheet on the web; BottomSheet now closes on Escape (re-run: closes, focus back on the button) |
| D5 | Follow | Follow → "Following"; the Following feed shows only followed creators; Unfollow → gone | FAIL→fixed→PASS: follow → Following shows only demo_rio's 4 posts; unfollow from the Following feed empties it at once (was: posts stayed until refetch). Fix: onAnyFollow in lib/social.ts, feed filters by live follow state |
| D6 | Following, empty | Following nobody: the Following feed says so and offers the For you feed | FAIL→fixed→PASS: empty-state box no longer collapses (PlaceholderBox min-height 260) |
| D7 | Share | Share copies (or shares) the coin's link; a sentence confirms | PASS: Reels Share → navigator.share gets title 'Board Check', text '… $SURF is live on Juno…', url /coin/0x0a99…8884; without Web Share → clipboard gets the same link + 'Link copied'; cancelled share → no copy, no toast; the link opens the $SURF coin page |
| D8 | Reels | Full-screen video plays; Like, Say, Share, Follow, market dock (cap, progress, Sell, Buy) | |
| D9 | Post page | `/post/<id>` shows the post and its thread; an unknown id shows "No such post" | FAIL→fixed→PASS: post created via POST /api/juno/posts (201, real DB) → /post/<id> shows author, body, the $DAWN card; the card's change was always '—' because hydratePool only read history when 'detailed' — now {history:true} works alone (post + watchlist pass it) → +830.41%, same as the coin page. Reply from the UI → 201, '1 reply', kept after reload; card opens /coin/0xa149…b3de; unknown id → 'No such post' + Back to the feed (→ /social), no console errors. NOTE: no screen links to /post/<id> and no UI creates top-level posts — reachable by URL only |
| D10 | Live tape | The tape connects to Monad testnet's stream and shows blocks moving Proposed → Voted → Finalized | SPLIT. Stream PASS: the server's socket to wss://testnet-rpc.monad.xyz is connected (GET /live → connected:true, fresh lastMessageAt); a probe of the same stream saw 41 blocks in 12 s, all four stages, Proposed→Voted median 268 ms, Voted→Finalized 248 ms, and logs carrying commitState + blockId as applyLog expects. FAIL→fixed: on the fork the tape polled /live every second for events that cannot arrive (the launchpad exists only on the fork) — now off on a fork like the finality timeline (0 requests in 9 s). Juno trades on the tape: UNTESTED — needs the contracts on real testnet (deployer has 0 MON) |
| D11 | Buy from the feed | Feed Buy opens the trade sheet for that coin (curve, Kuru or v2 pair as the coin requires) | PASS — feed Buy opens the trade sheet in place (over the tab bar) with the 1% size hint |

## E. A coin on its curve

| ID | Item | Correct means | Status |
|---|---|---|---|
| E1 | Coin page | Price, change, chart, creator, holders count, progress, market cap from the pool; no NaN, no unlabelled zero | FAIL → fixed → PASS. Price, change, chart, creator, holders, market cap, volume ($0.2550 = 8.83 MON × $0.0289), creator rewards all read from the pool; but the progress bar's left label read "$0.0(19)867" for a curve holding a few wei — price notation on a sum. New `sum()` formatter: "<$0.0001" |
| E2 | Chart ranges | 1H/1D/1W/1M/All each redraw from the history route without error | PASS — 1H/1D/1W/1M/All each redraw with their words ("past hour"…"all time"), one marked selected, no console output. Range buttons now carry spoken labels ("Past hour"…) instead of "1H" |
| E3 | Buy (spend) | Amount → server quote (receive, fee, impact) → Buy → "Bought N — confirmed on a local fork … in Ns" with tx and time; the token balance on chain rises by exactly the receipt's amount | PASS — 0.5 MON → quote 14,261 BLOOMK (fee 0.0062, impact 0.01%) → "Bought 14,274 BLOOMK — confirmed on a local fork of Monad testnet in 0.6s" + tx + time; chain: Trade.baseAmount 14,273.902857… = balanceOf to the wei |
| E4 | Buy (get exactly) | Token chip → "get exactly" → N tokens → "Costs X · at most Y" → the wallet holds exactly N more; unused MON refunded | PASS — "get exactly" 100,000 DAWN → "Costs 3.50 MON · at most 3.53 MON" → bought; chain: Trade.baseAmount exactly 100,000e18 for 3.4994 MON; the rest of the 3.53 cap refunded |
| E5 | Sell | 50% chip fills half the holding; the sell confirms; the chain balance halves | FAIL → fixed → PASS. 50% sold 63,140.699999999997 of 126,281.435… (rounded display value through a float): the balance did not halve, and 100% would have left 0.435 DAWN. Fixed: the pills send `sellFraction` and the server applies it to the raw `balanceOf` (100% = all of it); `uiToWei` no longer uses the float's binary expansion. Re-run: 50% sold exactly half to the wei, 100% left 0 on chain |
| E6 | Size hint | The sheet says how much moves the curve 1% (buy and sell sides) | PASS — buy: "81.34 MON moves it 0.98% · The most you can buy before the curve moves 1%"; sell: "126,281 DAWN moves it 0.05% · Everything the curve has sold, sold back, stays under 1%" |
| E7 | Over balance | An amount above the balance is refused in words before anything is signed | PASS — 0.5 MON against a 0.4957 balance: "Not enough MON — You have 0.4957 MON. Get testnet MON from your profile." before any signing |
| E8 | Close mid-flow | Closing the sheet after a quote and before Buy signs nothing; reopening starts clean | PASS: closed the sheet after a quote, no wallet prompt and no tx (nonce unchanged); reopening shows an empty amount and a fresh quote |
| E9 | Activity | The trade appears in Activity with side, amount and what was paid | PASS — all five trades with side, size and paid value (100,000 → $0.1011 = 3.4994 MON; 63,141 → $0.0626) |
| E10 | Holders | Holders list the buyer with a share; the indexer's freshness is named | PASS — e2e_tester 14,274 BLOOMK 100.0%; "from the Envio indexer's record of every transfer of this token, current to block 66,542,859" (head was 66,542,894) |
| E11 | Comments tab | A comment posted on the coin lists under Comments | PASS — Comments 1 → the thread with D4's comment |
| E12 | Details | Token address (copy), ticker, curve, quote, launchpad, network rows are right | PASS — Created, Token address, Ticker, Network "Monad testnet (local fork)", Quote MON, Curve, Format, Kuru market/pair, Launchpad, MonadVision links |
| E13 | Depth chart | Details show the depth chart ("x% buying $y") while the curve is open | PASS — "What a buy moves the price": 23.6% buying $85.69 · 69.2% buying $1.06k · 89.2% buying $6.95k |
| E14 | Creator fees | The creator sees claimable fees; Claim pays them; the card reads zero and the chain balance rose | FAIL → fixed → PASS. Claim paid out: `CreatorFeesClaimed` 0.134990075… MON, wallet +0.134931… (= claim − 0.0000589 gas); card "Nothing to claim yet", rewards $0. But "Claimed — view the transaction" pointed at MonadVision for a fork transaction it can never show (so did every explorer link on a fork). `juno.explorable()` hides them on a local fork; the claim shows its tx hash instead |
| E15 | Watch | Watch → "Stop watching", persists; the Profile's Watching lists the coin | PASS — Watch → "Watching" ("Stop watching"), kept after reload; server: watching true |
| E16 | Price alert | Setting an alert saves it and shows it on the coin | PASS — alert at $0.00002 → "Alert at $0.0₄200 · Fires when it rises to there."; server: alertPrice 0.00002 after reload |
| E17 | Plan | "Buy this every week" → 1 MON weekly → saved; listed in Profile → Plans; pause and delete work | FAIL → fixed → PASS. 1 MON weekly → saved (201) "Due now" → Put in 1.00 MON → bought 28,592 DAWN → "1.00 MON in, over 1 fill" (PATCH verified the fill on chain) → Pause/Resume (PATCH 200). But a plan could not be deleted from the app (API had DELETE, no control), and Pause/Resume/Remove were unlabelled to screen readers. Added Remove on paused plans + labels: DELETE 200, 0 plans after reload |
| E18 | Fill and graduate (v2) | A buy that fills the curve → "Curve full" + Graduate → "Graduated" with the pair; the curve refuses trades | PASS — 250,000 MON → "This fills the curve: it uses 243,073 MON and refunds the rest" → bought 711.94M DAWN → "Curve full" + Graduate → "Graduated · Trades on its Uniswap v2 pair now, right here"; chain: pair reserves = the curve's migration base (278,029,335.72 DAWN) and threshold (240,643.617 WMON), all LP at 0x…dEaD but the 1,000-wei minimum, a direct curve buy reverts `CurveComplete` |
| E19 | Trade on the pair | After graduation, Buy and Sell fill on the Uniswap v2 pair ("Fills against …'s Uniswap v2 pair"); the sell adds an approval step; balances move by the receipt's amounts | FAIL → fixed → PASS. Buy 10 MON on the pair → 11,518 DAWN ("on Uniswap v2"); Sell 25% → approval (1/2) + sell (2/2), exactly a quarter of the raw balance. But every v2 trade was listed twice and counted twice in volume ($12.44k): the receipt row was keyed on the router's log, the indexer's on the pair's, and stored rows lost their venue (no column). Fixed: pair-log ids, a `venue` column (migration 0001), and the merge treating one v2 fill per tx+coin as one. Re-run: 9 trades, $9,729.71 volume |
| E20 | Unknown coin | `/coin/0x…dead` → "No such coin"; `/coin/notanaddress` → the same screen, no crash | FAIL→fixed→PASS: /coin/notanaddress threw (bad address hit the API); now validated client-side → 'No such coin' with zero API calls; 0x…dead → same screen |

## F. Kuru

| ID | Item | Correct means | Status |
|---|---|---|---|
| F1 | Graduate into Kuru | "Open on Kuru" graduates a full Kuru-venue curve; the page shows "On Kuru", bid, ask and the market link | FAIL→fixed→PASS: filled BLOOMK from the sheet — note 'uses 243,074 MON and refunds the rest'; chain: 243,073.86 MON spent, +711,956,390 BLOOMK (quoted 711.96M). 'Buy only what's left' kept offering itself after being applied (its 0.05% margin) — now hidden once applied. 'Curve full … Anyone can' → Open on Kuru → graduated; page: On Kuru, Bid 0.000857 / Ask 0.0008655 MON, spread 1.00% = bestBidAsk() on market 0x8E2D…8238 (base token BLOOMK); Details lists the Kuru market; no explorer link on a fork (by design) |
| F2 | Trade on Kuru | The sheet says it fills on the Kuru market; a buy and a sell confirm; balances agree with the chain | PASS: sheet says 'Fills on BLOOMK's Kuru market … Kuru charges the taker fee'. Buy 10 MON → quote 11,519 (0.30% fee at ask 0.0008655); chain: 10 MON + 0.00016 gas, +11,518.911 BLOOMK. Sell 25% → quote 93,285.94 MON; chain: +93,285.934 MON, sold 177,995,545.797 = exactly ¼ of the balance floored to Kuru's 1e-6 size precision |
| F3 | Limit orders | A bid placed appears in "Your orders on Kuru"; Cancel removes it; Withdraw empties "Kuru holds" | FAIL→fixed→PASS: the limit-order sheet (and every sheet written inside a card: price alert, weekly buy, perps) filled its card, not the screen — hung mid-page, scrolled with it, no backdrop; BottomSheet now renders through a root Portal. Bid 1,000 @ 0.0003 → 'Locks about 0.3000 MON', listed, on chain s_orders(1) = owner/1e9 size/300 price/isBuy; Cancel → gone (size 0), 'Kuru holds 0.3000 MON'; Withdraw → +0.29995 MON net of gas. Offer 1,000 @ 0.001 → listed; Cancel → 'Kuru holds 1,000 BLOOMK'; Withdraw → +1,000.0 BLOOMK |
| F4 | Kuru history | Kuru fills appear in Activity; holders exclude Kuru's MarginAccount | FAIL→fixed→PASS: one 178M sell showed as ~100 Activity rows (one per price level Kuru filled) and pushed every other trade out; portfolio counted it as 100 trades. Fills are now one trade per (tx, trader, side) — coalesceFills, 6 unit tests — and Kuru is read 25× deeper with the history marked partial if any source is cut. Activity: Sell 178.00M $2.69k · Buy 11,519 · Buy 711.96M · Buy 14,274; total volume $9,715.70 = their sum. Holders: only the wallet, 533,986,637.391 BLOOMK = balanceOf to the wei; Kuru's MarginAccount excluded |

## G. Trade tab

| ID | Item | Correct means | Status |
|---|---|---|---|
| G1 | Pre-IPO | OpenAI, Kalshi, SpaceX with Tessera marks (matching Tessera's API) and logos; each lists its tracker | PASS: OpenAI $812.79 / 13.9K holders / $950B, Kalshi $413.80 / 2.9K / $14B, SpaceX $423.00 / 1.2K / $800B = rest-api.tessera.pe token-details (812.79/13,870/950e9, 413.8/2,867/14e9, 423/1,221/800e9); logos load (6 images, none broken); each lists its tracker ($OPENAIX tight-nav, $KALSHIX thin-name, $SPACEXX ipo-book) with 'Implies $813.10/share · +0.04% vs mark · inside ±2% band' = price ÷ unitsPerToken, bands ±2/±5/±4% = bandBps 200/500/400 |
| G2 | Stocks | Stock trackers with their Pyth reference; a stale mark says its age | PASS: Apple $308.88 'Pyth, 129d old', NVIDIA $225.11 '136d old', logos load, trackers $AAPLXI ipo-book / $NVDAXI thin-name with curve-vs-price +0.03%/+0.02%. Checked at the source: real Monad testnet Pyth (original contract) getPriceUnsafe(AAPL) = 30888000e-5 = 308.88, publishTime 2026-05-22 20:00 UTC = 129 days; the upgraded contract has no equity feed (reverts). A live equity mark needs Hermes, which answers 401 without a key (no PYTH_API_KEY set) — see J6 |
| G3 | Memes | Post coins with cap, progress, Trade/labels | PASS: 15 post/reel coins (the 5 trackers excluded — they are under Pre-IPO/Stocks), each with cap, likes, replies, progress or venue label (On Kuru / Graduated / <0.01% / 0%) and Trade. Replies = /api/juno/comments per coin for all 20 coins (e.g. AVE 2, NEON 1, BLOOMK 1); likes 0 = /api/juno/likes counts; caps = /api/juno/coins (BLOOMK $9.29k, DAWN $9.30k, TIDEWTR $24.99k) |
| G4 | Perps markets | Perpl markets with live marks, 24h change, funding, OI | FAIL→fixed→PASS: 7 Perpl markets (BTC 15x … PUMP 5x) with mark, 24h change, funding, OI, volume = testnet.perpl.xyz /v1/pub/context (BTC $84,141.70, OI $1.97M, +0.0030%, 15x exact; others within seconds of drift). But 'live' was one read at load — never refreshed. useApi gained a silent poll (no spinner; a failed poll keeps what is shown) and the list polls every 10 s: requests at 38/49/59 s, all 200, marks moved on screen |
| G5 | Perps trade | Open account → deposit → open a position → close → withdraw, each confirmed | SPLIT. On the fork, signed: Open account 150 AUSD → Perpl account #738, balance 150, wallet 350 (chain + API agree); Withdraw → balance 0, wallet 500 AUSD (label now 'Withdraw all' — one tap takes everything). Open position on the fork → refused before signing: 'Perpl's BTC price is 38456s old, past its 60s limit, so new positions are paused' — true: the fork froze Perpl's mark. Open → close proven against LIVE testnet with scripts/perps-simulate.ts (eth_simulateV1, AUSD balance override): approve ok, createAccount ok, 2x long 353 lots @ $83,990.3 ok, close @ $83,980.3 ok (P&L −0.0353). A signed open/close on testnet: UNTESTED — needs testnet MON + AUSD (Agora faucet dry). Fork AUSD came from anvil_setStorageAt (fork-only) |
| G6 | Traders | Ranked by realised P&L; says whether the ranking is complete | FAIL→fixed→PASS: ranked by realised P&L (+$1.89k … −$0.0204), but (1) nothing said the ranking was complete — now 'Every trade on all 20 pools, ranked by profit taken' (partial already had its footnote); (2) e2e_tester showed +$1,670.34 while an independent average-cost recomputation from raw indexer rows gave $1,892.07 (DAWN 952.91 + BLOOMK 939.16 = the portfolio's realisedPnl): the board's Kuru pager stopped after page 1 because merged trades made a full page of fills look short — half the sell was missing (my regression from F4). Paging now counts raw fills: board = $1,892.07 realised, −$603.38 open, $9,928.47 holding = portfolio; 13 trades = 9 curve + 2 Kuru orders + 2 pair (indexer count) |
| G7 | Tracker coin | A tracker's page shows its reference and the band; outside the band the sheet warns before signing | FAIL→fixed→PASS: OPENAIX Details shows 'T-OpenAI reference · Published mark $812.79 · +0.04% … implies $813.10 … inside this preset's 2% band'. Fixed: (1) its stats read '13850' and '$950000.00M' — now the Pre-IPO list's formatters ('13.8K', '$950B'), and money() gained B/T tiers chosen after rounding (tests: $950.00B, $2.50T, 999,999,999 → $1.00B); (2) the sheet warned only when the curve was ALREADY outside the band — a buy that would take it outside said nothing. It now warns from the trade's average price (a floor on where it leaves the curve): 4,000 MON (3.73% impact) → 'On average this buy pays 3.9% above T-OpenAI's mark, outside its 2% band…'; 100 MON (0.10%) → no warning. Stale reference: AAPLXI sheet → 'AAPL's price is stale, so this curve can't be checked against it right now.' |

## H. Profile and other wallets

| ID | Item | Correct means | Status |
|---|---|---|---|
| H1 | Portfolio | Value, P&L, positions and trade count agree with the wallet's trades | PASS: $9,928.47 = DAWN $4,968.27 + BLOOMK $4,960.20 (balance × price); P&L $1.29k = realised 1,892.07 + unrealised −603.38; 2 positions, 13 trades (= indexer: 9 curve + 2 Kuru orders + 2 pair); balances on chain: 250,202.07 MON, 533,986,637.03 DAWN, 533,986,637.39 BLOOMK — all equal to the page |
| H2 | Watching tab | Lists watched coins with prices | PASS: Watching lists DAWN $0.0₅930 +830.41% (was '—' until the D9 hydrate fix) with its alert 'Alert at $0.0₄200' |
| H3 | Plans tab | Lists plans from Postgres | FAIL→fixed→PASS: created a plan from DAWN's page (5 MON weekly, goal 50) → POST 201, row in Postgres. 'Put in 5.00 MON' bought 15,475 DAWN on v2 but 'was not recorded against your plan' — verifyFill only accepted the curve's Trade event, so no graduated coin could ever record a contribution. It now accepts the router's Swapped (v2) and the coin's Kuru market Trade (wallet as taker); a failed record keeps the fill with a 'Record it again' link. Re-run: next buy recorded (5 of 50, 1 fill); the first tx re-sent via the same PATCH → 10 of 50, 2 fills = psql row (contributed 10, fills 2); a Kuru buy verified on a BLOOMK plan (then deleted); a sell tx is refused. Plans tab: 'Falls at Dawn · 5.00 MON ($0.1444) weekly · 2 fills · 10.00 of 50.00 MON' |
| H4 | Trader page | `/trader/<wallet>` shows rank, stats, holdings and trades; an unknown wallet says so | PASS: from Traders → /trader/0x82eb…9d7a: Creator, '#2 by profit taken', +$1.44 taken, $10.32k open, 100% win, 4 fills, 1 coin; holding 711.93M TIDEWTR $17.79k = balanceOf 711,928,246.9 × $2.4992e-5; 4 trades listed. A valid address with no history → 'No fills from this wallet on any Juno pool yet' / 'holds none of the coins'; /trader/notawallet → 'No such wallet — That is not a Monad address' with Back to the feed; no console errors |

## I. API, every method (from the browser, `fetch`)

| ID | Item | Correct means | Status |
|---|---|---|---|
| I1 | `GET config` | 200: chainId, launchpad, quote tokens, `v2Trading: true`, `localFork: true` | PASS: 200 chainId 10143, launchpad set, v2Trading true, localFork true |
| I2 | `GET coins`, `coins/[token]` | 200 lists; unknown token 404; bad address 400 | PASS: coins 200 (20, missing 0); coins/DAWN 200; coins/0x…dEaD 404 'Coin not found'; coins/notanaddress 400 'Not a Monad address: token' |
| I3 | `GET feed`, `posts`, `posts/[id]` | 200; unknown post 404 | PASS: feed 200 (33 items); posts 200; posts/<id> 200 (1 reply, change 8.31 after the D9 fix); unknown id 404 'Post not found'; POST posts bad author/empty body → 400 sentences |
| I4 | `GET depth` | 200 levels for an open curve; bad token 400 | PASS: depth OPENAIX 200 (12 points); bad token 400; graduated DAWN 200 with 0 points (no curve left) |
| I5 | `GET leaderboard`, `portfolio/[wallet]` | 200; bad wallet 400 | PASS: leaderboard 200 (partial false, 20/20, 9 traders); portfolio 200 ($9,929, 2 positions); portfolio/bad 400 |
| I6 | `GET tessera`, `perps`, `perps/account` | 200 from the real services | PASS: tessera 200 (3 companies from rest-api.tessera.pe); perps 200 (8 markets from Perpl); perps/account 200 (#738); bad owner 400 |
| I7 | `GET live`, `index` | `live` connected; `index` caught up | PASS: live 200 connected (wss testnet); index 200 cursor = latest = 66547773, caughtUp true |
| I8 | `GET tx/balance` | 200 exact balance; bad input 400 | FAIL→fixed→PASS: 200, but only a JS float (534017586.05474454 vs 534017586.054744538367133064 on chain). Now also 'raw' in wei as a string = balanceOf exactly (MON and tokens); bad wallet/token → 400 |
| I9 | `POST tx/swap` | Quote and steps for buy/sell/exact-out; amount 0, bad token, bad side → 400 sentences | PASS: buy (curve) 1 step, exact-out (max in 0.0351), sell on v2 (venue uniswap-v2), sell 50% on Kuru (venue kuru); amount 0 → 'Amount must be greater than zero'; bad token → 400; side 'hold' → '"side" must be "buy" or "sell"'; unknown coin → 404; bad JSON → 'Invalid JSON body' |
| I10 | `POST tx/launch`, `tx/claim`, `tx/graduate` | Steps for valid input; each bad input → 400 | PASS: launch 200 (1 step); empty name / 'H!' / preset 'nope' → 400 sentences; claim 200 for the creator, 403 'Only the creator can claim', bad token 400; graduate an unfilled curve → 400 'The curve has not filled yet', bad token 400 |
| I11 | `POST tx/submit` | A garbage raw tx → 400 with a sentence, not 500 | PASS: garbage → 400 'That is not a signed Monad transaction'; empty/missing → 400 '"signed" is required' |
| I12 | `POST upload`, `metadata`, `GET ipfs/[cid]` | Upload pins and returns a CID; metadata pins JSON; the IPFS route serves the bytes; a bad CID → 400 | PASS: upload (browser FormData and curl) → 201 {cid, uri, url, mimeType, width, height}; /api/ipfs/<cid> 200 image/png, sha256 = the bytes sent; metadata → 201, JSON read back from gateway.pinata.cloud with name/symbol/description; bad CID → 400; empty metadata → 400; non-image upload → 415 (refused before pinning). The route sends no CORS header — correct for its callers (<img>/<video> only; nothing in the app fetch()es media) |
| I13 | Social writes | `comments`, `likes`, `follow`, `profiles`, `watchlist`, `plans` (GET/POST/PATCH/DELETE): a bad signature or wallet → 400/401, never 500 | FAIL→fixed→PASS: every bad wallet/token/body → 400 sentence (comments, likes, follow incl. 'cannot follow itself', profiles incl. bad signature 'does not match this wallet' and expired request, privy 400, watchlist incl. alert ≤ 0, plans incl. cadence/amount/txHash/id). But likes accepted liked:"yes" (and "false" liked!) — follow and watchlist had the same 'anything but false' parsing; all three now require a boolean (400), state untouched. requireString now says 'must be a string' for a present non-string instead of 'is required' |
| I14 | `kuru/*`, `perps/*` writes | Bad input → 400 sentences | PASS: kuru/order price/amount ≤ 0 → 'must be greater than zero', non-Kuru coin → 'This coin does not graduate into Kuru', bad side → 400; cancel empty ids → 400; withdraw bad owner → 400; orders on a non-Kuru coin → 404; perps open/close/deposit/withdraw → 400 sentences (no balance, no such market, no position, 'This wallet holds 500 AUSD', 'withdraw up to 0 AUSD') |
| I15 | `pools` | GET 200; POST without a real launch tx → 400 | PASS: GET pools 200 (20); POST with a token that has no launch → 404 'There is no Juno pool for this token on this network' (also with a real but unrelated tx); bad token 400 |
| I16 | `saved` | 200 for a wallet; bad wallet 400 | PASS: saved 200 (watching true, 1 plan); bad wallet 400. Faucet GET 200 (fork faucet 1,000 MON, 0.5 per drip); POST bad wallet 400 |

## J. Indexer and integrations

| ID | Item | Correct means | Status |
|---|---|---|---|
| J1 | Envio | GraphQL answers; the trades it holds for a coin equal the receipts on the fork | |
| J2 | Tessera | The marks the app shows equal Tessera's API | |
| J3 | Pyth | MON/USD from Pyth's contract; equity marks labelled with their age | |
| J4 | Pinata/IPFS | Uploaded bytes come back identical from the gateway | |
| J5 | Kuru / Perpl | Reads from the real forked contracts | |
| J6 | Fresh equity marks | Needs `PYTH_API_KEY` | UNTESTED (no key) |
| J7 | Real testnet lifecycle | Needs MON for the deployer | UNTESTED (testnet) |

## K. Suites

| ID | Item | Correct means | Status |
|---|---|---|---|
| K1 | Contracts | `forge test` all pass | |
| K2 | App/API | unit tests, three typechecks, production build | |
| K3 | Indexer | `pnpm test` | |
| K4 | Stand-ins | No mock, stub or fallback data in shipped code | |
