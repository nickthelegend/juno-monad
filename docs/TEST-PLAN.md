# Juno test plan

Every screen and flow in the app, what "correct" means for each, and how it
was run. Results are recorded in [Results](#results) after a full pass, the
failures fixed at their cause, and the whole plan run again.

## Environment

- **Chain:** a local anvil fork of Monad testnet (chain 10143), with Juno's
  contracts deployed by `contracts/script/Deploy.s.sol`. Real testnet is
  blocked on faucet MON for the deployer (see `docs/FEATURES.md`, Blockers).
  Kuru, Pyth, Perpl, USDC and WMON are the real testnet contracts, forked.
- **API:** `npm run dev` on `:3100` against the fork (`.env.development.local`).
- **Indexer:** Envio HyperIndex in RPC mode against the fork, GraphQL on `:8080`.
- **App:** the Expo web build on `http://localhost:3000`, driven in Chrome
  (Claude in Chrome), with the console and network log read after each step.
- **Wallets:** a device key created in the browser, funded on the fork with
  `anvil_setBalance` (fork MON has no value). Anvil's public dev keys are
  never used as traders: on Monad testnet they carry EIP-7702 sweeper
  delegations, which a fork inherits.

A case **passes** only if its definition of correct holds *and* the console
shows no error and no request in the flow returns 5xx. **Untestable** marks a
case that needs a person or an account the tester does not have; it is not a
pass.

## Cases

### A. Shell and navigation

| ID | Case | Correct means |
|---|---|---|
| A1 | First visit | The landing renders with "Get Started"; `GET /api/juno/config` returns 200 with chain 10143 and the launchpad address; tapping through lands on the feed |
| A2 | Tab bar | Feed, Trade, +, Reels and Profile each open their screen; the active tab is marked |
| A3 | Unknown route | An unknown path shows the not-found screen with a way back, not a blank page |
| A4 | Web frame | On a wide window the app is a column at most 480px wide, centred |

### B. Wallet and identity

| ID | Case | Correct means |
|---|---|---|
| B1 | Create a device wallet | Profile → Create wallet shows an address; a reload keeps the same address |
| B2 | Testnet faucet | "Get testnet MON" sends MON from the server's sealed faucet key; the balance shown rises by the amount the message states |
| B3 | Claim a name | Signing the EIP-191 message sets the name; the name replaces the short address on the profile |
| B4 | Signer choice (web) | "Sign with: Device key / Privy" renders; choosing Privy and "Sign in with Privy" opens Privy's modal with email, Google and X |
| B5 | Privy login and signing | A person logs in, gets an embedded wallet, and signs a buy through Privy's confirmation |
| B6 | Privy identity route | `POST /api/juno/profiles/privy` with a bad token answers 401 with a sentence |

### C. Launch

| ID | Case | Correct means |
|---|---|---|
| C1 | Launch a photo post | Pick an image, name, ticker → upload to IPFS, pin metadata, one launch transaction, listing; the coin page opens with the photo, name, ticker and 0% progress |
| C2 | Launch choosing Kuru | With "Kuru order book" selected the launch succeeds; the coin's details say "Kuru market: Opens at graduation" |
| C3 | Creator first buy | With "5 MON" chosen, the creator holds tokens right after the launch, bought in the launch transaction |
| C4 | Launch validation | With no media, no name or a bad ticker the button is off and a sentence says why |
| C5 | Venue rules | `POST /api/juno/tx/launch` with USDC and Kuru answers 400 "A Kuru market is priced in MON…" |

### D. Feed and reels

| ID | Case | Correct means |
|---|---|---|
| D1 | Feed | Posts render with their market cap, progress and Buy; no placeholder art where media exists |
| D2 | Like, comment, save | A like toggles and persists across reload; a comment appears under the post; save adds it to Watching |
| D3 | Reels | Reels play full-screen with the market dock |
| D4 | Live tape | The tape connects and shows blocks moving through Proposed → Voted → Finalized |

### E. A coin on its curve

| ID | Case | Correct means |
|---|---|---|
| E1 | Coin page | Price, market cap, volume, holders and the chart render from the pool; no "NaN", no unlabelled zero |
| E2 | Buy | Typing an amount shows a quote (receive, fee, impact) from the server; Buy confirms, shows "confirmed on Monad in Ns" and the finality timeline; the trade appears in Activity |
| E3 | Sell | The 50% chip fills half the holding; the sell confirms; the balance halves |
| E4 | Size suggester | The sheet says how much moves the curve 1% |
| E5 | Over-balance | An amount above the balance is refused in words before anything is signed |
| E6 | Comment on a coin | The comment appears in the Comments tab |
| E7 | Holders | Holders list the buyer with a share; the caption names the indexer and its freshness |
| E8 | Details | The token address copies; the venue row reads the pair or the Kuru market |
| E9 | Creator fees | The creator sees claimable fees; Claim pays them and the balance drops to zero |
| E10 | Fill and graduate (Uniswap) | A buy that fills the curve shows "Curve full" and Graduate; graduating shows "Graduated" and a pair link; the curve refuses trades |

### F. Kuru

| ID | Case | Correct means |
|---|---|---|
| F1 | Graduate into Kuru | "Open on Kuru" graduates; the page shows "On Kuru", the book's bid and ask, and the market link |
| F2 | Trade on Kuru | The trade sheet says it fills on the Kuru market; a buy and a sell confirm |
| F3 | Limit orders | A bid placed in the sheet appears in "Your orders on Kuru"; Cancel removes it; Withdraw empties "Kuru holds" |
| F4 | Holders and history | Kuru fills show in Activity; holders exclude Kuru's MarginAccount |

### G. Trade tab

| ID | Case | Correct means |
|---|---|---|
| G1 | Pre-IPO | Tessera companies render with their marks |
| G2 | Stocks and Memes | Each list renders its coins or an empty state that says why |
| G3 | Perps markets | Perpl's markets render with live marks, 24h change, funding and OI |
| G4 | Perps trading | Open account → 2x BTC long → position with liquidation price → Close → Withdraw |
| G5 | Traders | The leaderboard ranks wallets by realised P&L and says whether it is complete |

### H. Profile

| ID | Case | Correct means |
|---|---|---|
| H1 | Portfolio | Value, P&L, positions and trades reflect the wallet's trades |
| H2 | Watching | A saved coin is listed with its price |
| H3 | Plans | A recurring-buy plan saved from a coin page is listed |
| H4 | Trader page | Another wallet's page shows its positions and trades |

### I. API

| ID | Case | Correct means |
|---|---|---|
| I1 | Bad input | Swap with amount 0, a malformed address, an unknown preset: 400 with a sentence, never 500 |
| I2 | Health | `config`, `coins`, `live`, `index`, `perps` answer 200 |
| I3 | Page requests | A browser page request to the API host redirects to the app |

### J. Automated suites

| ID | Case | Correct means |
|---|---|---|
| J1 | Contracts | `forge test` passes; `KURU_FORK_TEST=1 … KuruGraduatorForkTest` passes against forked Kuru |
| J2 | App and API | `npx vitest run`, both `tsc --noEmit` pass |
| J3 | Indexer | `pnpm test` in `indexer/` passes |
| J4 | Perpl against live testnet | `npm run juno:perps-simulate` opens and closes a position in simulation |
| J5 | Static analysis | `slither . --fail-medium` in `contracts/` reports no medium or high finding; each one judged safe says why beside the line |
| J6 | Indexer types | `pnpm codegen && pnpm typecheck` in `indexer/` passes |

## Results

### How the run went

The first pass ran on 2026-09-24 in Chrome against the fork. Two things about
the harness, not the app, shaped how it was driven:

- **Synthesized clicks did not reach the page.** A capture listener on the
  document recorded no `pointerdown`, `mousedown` or `click` for the tool's
  clicks, so the steps were driven with DOM events (`element.click()`,
  React-compatible input events) and read back from the DOM, the console and
  the network log. One exception needed a real click: Privy's modal ignores
  untrusted events, and its close button was clicked with the mouse.
- **The Mac's internal disk filled up mid-run** (200 GB used, about 100 MB
  free). Postgres began refusing writes ("No space left on device") and Docker
  Desktop stopped answering, which took the Envio indexer down. H3 failed for
  that reason, and the second pass is paused until there is space again. The
  app degraded as designed while the indexer was down: the leaderboard fell
  back to per-pool history and said it was incomplete.

### First pass

| ID | Result | Notes |
|---|---|---|
| A1 | PASS | Landing → feed; `config` 200 with chain 10143 |
| A2 | FAIL → fixed | Every tab navigated, but no tab said which was current (`aria-selected` never reached the DOM). Fixed for tabs, segments and toggles |
| A3 | PASS | "Nothing here … Go to the feed" |
| A4 | PASS | 480px column on a 1568px window |
| B1 | PASS | Device key created; same address after reload |
| B2 | PASS | "0.5 MON received"; balance 0 → 0.5 |
| B3 | PASS | `tester_189` claimed with an EIP-191 signature, shown as the handle |
| B4 | PASS | Privy modal: email, Google, X |
| B5 | UNTESTABLE | Needs a person to log in to Privy |
| B6 | PASS | 401 "That Privy session is not valid. Sign in again." |
| C1 | PASS | Real PNG → IPFS → launch → listing → coin page with the photo, name, caption, ticker |
| C2 | PASS | Kuru launch; Details: "Kuru market — Opens at graduation" |
| C3 | PASS | 1 MON first buy: 21,874 GARDEN held after the launch transaction |
| C4 | FAIL → fixed | "Add a photo to launch" shown, but the disabled Launch button did not say it was disabled (`aria-disabled` dropped). Buttons now pass `disabled` |
| C5 | PASS | 400 "A Kuru market is priced in MON…" |
| D1 | FAIL → fixed | Feed rendered, but a Kuru-graduated coin showed no Buy though it trades in the app. Fixed on the feed card, Memes list and reels dock |
| D2 | PASS | Like → Unlike, count 1, kept after reload; comment in E6; Watch in H2 |
| D3 | NOT RUN | No reels on this fork; the empty state renders ("No reels yet"). Needs a video launch |
| D4 | UNTESTABLE on the fork | The tape follows Monad testnet's WebSocket (connected, per I2); fork trades are not on that chain |
| E1 | PASS | Price, market cap, volume, holders, progress |
| E2 | PASS | 2 MON → 44,325 GARDEN, "confirmed on Monad in 1.2s", in Activity. The finality timeline follows real testnet, so it stays empty for a fork trade |
| E3 | PASS | 50% chip → 33,100 of 66,200; sold for 1.29 MON |
| E4 | FAIL → fixed | Buy side correct ("107.48 MON moves it 1.00%"); the sell side called the whole holding "the most you can sell before the curve moves 1%" |
| E5 | PASS | "You have 47.00 MON…" before signing |
| E6 | PASS | Comment posted and listed. The sheet's Post control had no button role (fixed) |
| E7 | PASS | tester_189, 100%; "current to block 65,187,323" |
| E8 | PASS | Token, ticker, pair, launchpad rows |
| E9 | FAIL → fixed | Claim paid out, but the card showed the paid amount beside "Claimed" until the re-read finished |
| E10 | PASS | Filled with a refund; "Curve full" → Graduate → "Graduated"; curve refuses trades (400); price now from the pair's reserves ($25k cap) |
| F1 | FAIL → fixed | Opened on Kuru; bid and ask both printed "0.0010 MON" |
| F2 | PASS | 5 MON → 4,794 ORCHARD; 1,000 ORCHARD → 1.03 MON, approval included |
| F3 | PASS | Bid listed, cancelled (2.04 MON back), withdrawn |
| F4 | PASS | Kuru fills in Activity; holders exclude the MarginAccount |
| G1 | PASS | OpenAI, Kalshi, SpaceX with Tessera marks |
| G2 | FAIL → fixed | Stocks: empty state with a reason. Memes: a Kuru-graduated coin was labelled "On Uniswap v2" |
| G3 | PASS | Live Perpl markets |
| G4 | PASS (fork, see note) | Account with 150 AUSD → 3x ETH short (liq $3,449.68) → Close → Withdraw ($299.86 back). On the fork, AUSD was dealt to the test wallet and a local keeper kept Perpl's marks fresh |
| G5 | PASS | Ranked by realised P&L. While the indexer was down it said the ranking was incomplete, which was true |
| H1 | NOT RUN | Paused by the disk |
| H2 | PARTIAL | Watch → "Watching"; the profile's Watching tab not yet checked |
| H3 | FAIL (environment) | `POST plans` 500: Postgres "No space left on device". To re-run |
| H4 | NOT RUN | Paused by the disk |
| I1 | PASS | Eight bad inputs, each 400 with a sentence |
| I2 | PASS | `config`, `coins`, `live` (connected), `index` (caught up), `perps` |
| I3 | PASS after config | With `JUNO_APP_URL` unset the server shows its status page, as documented; set, pages and coin links redirect (307) and `/api` is untouched |
| J1 | PASS | 55 tests + 7 Kuru fork tests |
| J2 | PASS | 328 vitest; both typechecks |
| J3 | PASS | 8 indexer tests |
| J4 | PASS | 3x BTC long opened and closed in simulation against live testnet |

Every FAIL → fixed above is in commit `e51a19b`. The second pass re-runs the
whole plan once there is disk space again.

### Second pass (started 2026-09-24, after a restart)

The stack was rebuilt from nothing: a fresh fork at block 65,197,097, Juno
redeployed, the indexer re-synced. The cases the first pass could not finish
came first.

| ID | Result | Notes |
|---|---|---|
| E2 | FAIL → fixed | A Kuru buy on the fork said "confirmed on Monad in 0.8s", crediting Monad with anvil's time. `GET config` now reports `localFork` and the sheet says "confirmed on a local fork of Monad testnet in 0.8s" (seen in Chrome after the fix). Commit `38a7d51` |
| F2 | PASS | 2 MON → 39,880 KURU410 at the book's 0.00005 MON ask; the indexer recorded the fill (`KuruTrade` `0xef8d…56c6`) |
| H1 | FAIL → fixed | Value, P&L and the position were right, but the header said **2 Trades** for a wallet with one. It counted the points of the value chart (`history`), not trades. It now counts the trades the Activity tab lists: "1 Positions · 1 Trades" after the fix |
| H2 | PASS | Watch → "Stop watching", kept after reload; the profile's Watching tab lists KURU410 with its price |
| H3 | PASS | Details → "Buy this every week" → 1 MON weekly → Start; the coin shows "Due now", and the profile's Plans tab lists "1.00 MON ($0.0239) weekly" from Postgres |
| H4 | FAIL → fixed | Another wallet's page showed its rank, stats ("3 Fills") and holdings, but not the trades behind them. It now lists them with the `TradeList` the Activity tab uses. Re-checked in Chrome: three rows for `0x391b…C211` |
| H4b | FAIL → fixed | Those rows then said the 711.97M-token curve fill went "at $0.0₅120", while the holding's average cost was $0.0₆516. The row printed the mark *after* the trade. Trades now carry what was paid, and rows read "Paid $367.62 · $0.0₆516 each" |
| E8 | PASS (new behaviour) | A Kuru-venue coin on its curve shows "Kuru market 0x36bC…b594 · opens at graduation", and the Network row says "Monad testnet (local fork)" on the fork. On a coin launched, filled and graduated by script, the address shown before graduation was the market Kuru opened (`0xf749…9a2a`, "PREDICTION MATCHES") |
| D3 | PASS | A 6-second 720×1280 H.264 reel, launched through the Post screen's API calls (upload to IPFS with a server-made poster frame, metadata, launch, list). In the built-in browser at phone size the Reels screen plays it (`readyState` 4, muted, looping) with Like, Say, Share, Follow and the market dock (market cap, progress, Sell, Buy). Chrome could not show it: its window was minimised, so the page was 0×0 and Chrome would not load video. Launching the reel through the screen itself stalled for the same reason, at the picker's metadata read |
| — | FAIL → fixed | The launch step for a reel said "Launching your post". It says "Opening its market" for posts, reels and trackers alike |
| J1 | PASS | 56 tests (one new: a launch with no graduator is refused) and the 7 Kuru fork tests against live testnet state |
| J3 | PASS | 8 indexer tests |
| J5 | FAIL → fixed | Slither found 29 results. One pointed at a real trap: `launch` accepted a pool with no graduator, whose curve could fill and then neither trade nor graduate. `launch` now reverts `NoGraduator`. Five medium or high results were false positives and are annotated with the reason (curves written through a storage pointer, a bit test, payees who chose themselves, one unused return, a truncation under one part in a billion). The 21 left are low or informational: deadlines and fee decay read the timestamp, the vendored Uniswap v2 core is solc 0.5.16 by design, native MON is sent with `call`. CI now runs Slither with `--fail-medium` |
| B2 | PASS | In a fresh browser wallet: the empty faucet answered 503 with "Juno's faucet is empty. Get testnet MON at https://faucet.monad.xyz…"; with the faucet funded on the fork, "0.5 MON received" and the balance went 0 → 0.5 |
| E2 | FAIL → fixed | A 0.2 MON buy quoted "Price impact 1.12%" beside a "97.63 MON moves it 0.98%" hint: the impact row included the 1% fee that has its own row. It now shows the curve's movement alone (0.00% here). The buy then confirmed: "Bought 4,764 REEL926 — confirmed on a local fork of Monad testnet in 0.6s", the amount quoted |
| E4 | FAIL → fixed | The Sell hint said "26,658 REEL926 moves it 0.01%. The most you can sell before the curve moves 1%" to a wallet holding 4,764. The route's default search ceiling for a sell was an estimate a little under what the curve can take back, so the search never knew it had reached the floor. It now uses the exact figure, and a seller whose holding is under the hint's size is told "All 4,764 REEL926 you hold: selling all of it moves the curve less than 1%" |
| E3 | PASS | 50% → 2,381.93; "Sold 2,382 REEL926 for 0.0980 MON — confirmed on a local fork of Monad testnet in 0.4s" |
| E2b | FAIL → fixed | After each trade the finality timeline polled `live?tx=` every 350 ms for as long as the sheet stayed open, about 40 requests a trade on the fork, where the transaction can never appear in Monad's stream. It no longer polls on a local fork and gives up after 15 s elsewhere |
| H1 | PASS | "1 Positions · 2 Trades"; Activity reads "Paid $0.0048 · $0.0₅101 each" and "Received $0.0024 · $0.0₆990 each" |
| — | FAIL → fixed | Opening the profile logged seven React errors ("Unknown event handler property onStartShouldSetResponder…"): the chart's SVG hit bands passed touch-responder props to DOM `<rect>`s. On the web they now take pointer events; pressing a band and hovering another move the readout to that point, with nothing in the console |
| A1 | PASS (changed) | The landing badge reads the network from the server: "Monad testnet (local fork) · no real money" on the fork |
| G3, G5 | PASS | Live Perpl markets; the leaderboard ranks three wallets |
| I1, I2 | PASS | `config`, `coins`, `live`, `index`, `perps` 200; amount 0, a bad address and an unknown preset each 400 with a sentence |
| J6 | FAIL → fixed | The indexer's handlers typechecked, but its test file did not: two simulated `OrdersCanceled` events passed a transaction hash the config does not select. Fixed, and CI now runs the indexer's codegen, typecheck and tests |

The internal disk filled a second time during this pass: free space fell from
about 600 MB to nothing at roughly 34 MB a minute, and the shell could no longer
write its output. The cause was anvil: with one-second blocks and no
`--prune-history`, it writes old fork states to a temp directory. Stopping it
returned about 5.8 GB. It now runs with `--prune-history 300` (states in
memory only), and the fork was rebuilt.
