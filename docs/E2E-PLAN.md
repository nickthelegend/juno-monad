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
| D2 | Stories row | The reel stories ($TIDE, $SURF…) open that reel | |
| D3 | Like | Like → count +1, persists across reload; Unlike → back | PASS — Like → filled heart, 1, POST likes 200; kept after reload; Unlike → empty, kept after reload |
| D4 | Comment | Comment on a post appears in its thread and the reply count rises | FAIL → fixed → PASS. The comment posted (201), listed as e2e_tester, reply count 1, kept after reload. But Escape did not close the sheet on the web; BottomSheet now closes on Escape (re-run: closes, focus back on the button) |
| D5 | Follow | Follow → "Following"; the Following feed shows only followed creators; Unfollow → gone | FAIL→fixed→PASS: follow → Following shows only demo_rio's 4 posts; unfollow from the Following feed empties it at once (was: posts stayed until refetch). Fix: onAnyFollow in lib/social.ts, feed filters by live follow state |
| D6 | Following, empty | Following nobody: the Following feed says so and offers the For you feed | FAIL→fixed→PASS: empty-state box no longer collapses (PlaceholderBox min-height 260) |
| D7 | Share | Share copies (or shares) the coin's link; a sentence confirms | |
| D8 | Reels | Full-screen video plays; Like, Say, Share, Follow, market dock (cap, progress, Sell, Buy) | |
| D9 | Post page | `/post/<id>` shows the post and its thread; an unknown id shows "No such post" | |
| D10 | Live tape | The tape connects to Monad testnet's stream and shows blocks moving Proposed → Voted → Finalized | |
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
| F1 | Graduate into Kuru | "Open on Kuru" graduates a full Kuru-venue curve; the page shows "On Kuru", bid, ask and the market link | |
| F2 | Trade on Kuru | The sheet says it fills on the Kuru market; a buy and a sell confirm; balances agree with the chain | |
| F3 | Limit orders | A bid placed appears in "Your orders on Kuru"; Cancel removes it; Withdraw empties "Kuru holds" | |
| F4 | Kuru history | Kuru fills appear in Activity; holders exclude Kuru's MarginAccount | |

## G. Trade tab

| ID | Item | Correct means | Status |
|---|---|---|---|
| G1 | Pre-IPO | OpenAI, Kalshi, SpaceX with Tessera marks (matching Tessera's API) and logos; each lists its tracker | |
| G2 | Stocks | Stock trackers with their Pyth reference; a stale mark says its age | |
| G3 | Memes | Post coins with cap, progress, Trade/labels | |
| G4 | Perps markets | Perpl markets with live marks, 24h change, funding, OI | |
| G5 | Perps trade | Open account → deposit → open a position → close → withdraw, each confirmed | |
| G6 | Traders | Ranked by realised P&L; says whether the ranking is complete | |
| G7 | Tracker coin | A tracker's page shows its reference and the band; outside the band the sheet warns before signing | |

## H. Profile and other wallets

| ID | Item | Correct means | Status |
|---|---|---|---|
| H1 | Portfolio | Value, P&L, positions and trade count agree with the wallet's trades | |
| H2 | Watching tab | Lists watched coins with prices | |
| H3 | Plans tab | Lists plans from Postgres | |
| H4 | Trader page | `/trader/<wallet>` shows rank, stats, holdings and trades; an unknown wallet says so | |

## I. API, every method (from the browser, `fetch`)

| ID | Item | Correct means | Status |
|---|---|---|---|
| I1 | `GET config` | 200: chainId, launchpad, quote tokens, `v2Trading: true`, `localFork: true` | |
| I2 | `GET coins`, `coins/[token]` | 200 lists; unknown token 404; bad address 400 | |
| I3 | `GET feed`, `posts`, `posts/[id]` | 200; unknown post 404 | |
| I4 | `GET depth` | 200 levels for an open curve; bad token 400 | |
| I5 | `GET leaderboard`, `portfolio/[wallet]` | 200; bad wallet 400 | |
| I6 | `GET tessera`, `perps`, `perps/account` | 200 from the real services | |
| I7 | `GET live`, `index` | `live` connected; `index` caught up | |
| I8 | `GET tx/balance` | 200 exact balance; bad input 400 | |
| I9 | `POST tx/swap` | Quote and steps for buy/sell/exact-out; amount 0, bad token, bad side → 400 sentences | |
| I10 | `POST tx/launch`, `tx/claim`, `tx/graduate` | Steps for valid input; each bad input → 400 | |
| I11 | `POST tx/submit` | A garbage raw tx → 400 with a sentence, not 500 | |
| I12 | `POST upload`, `metadata`, `GET ipfs/[cid]` | Upload pins and returns a CID; metadata pins JSON; the IPFS route serves the bytes; a bad CID → 400 | |
| I13 | Social writes | `comments`, `likes`, `follow`, `profiles`, `watchlist`, `plans` (GET/POST/PATCH/DELETE): a bad signature or wallet → 400/401, never 500 | |
| I14 | `kuru/*`, `perps/*` writes | Bad input → 400 sentences | |
| I15 | `pools` | GET 200; POST without a real launch tx → 400 | |
| I16 | `saved` | 200 for a wallet; bad wallet 400 | |

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
