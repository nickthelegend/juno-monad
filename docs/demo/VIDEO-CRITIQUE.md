# Critique of `juno-metropolis.mp4` (2:21), scored as a Metropolis judge

Watched with the `watch` skill (16 keyframes) against its own caption track.

## What a judge would mark down
1. **The frame is mostly empty.** The app is a 480 px phone column inside a 1280 px capture, upscaled. On the landing, search and coin pages, about two thirds of the frame is plain sage, and the app's text is small at 1080p. That fails the "filling the frame" rule.
2. **A quarter of it is slides.** The intro is 35 s of motion graphics before any real product. The rules want the product "in actual operation". The problem and the intended user should be told over real footage, in about 15 s.
3. **The core creator flow is missing.** The video never posts a photo and launches a coin, which is the product's whole premise. It never shows a creator's earnings or a claim either. A judge sees a trading app, not a creator market.
4. **Sponsor depth is thin.**
   - Kuru appears as one market buy, with no order book and no limit order (the Consumer bounty is about the book).
   - Perpl's Risk view, which is its own claimed bounty, is never opened.
   - Envio is never visible.
   - Chainlink CRE is one badge held for a few seconds.
5. **Monad proof is half-shown.** The receipt's "Final" timer still showed "…" when the shot moved on. The gas detail (limit billing) and the txpool status are never opened.
6. **Dead air and loading.**
   - Typing into search.
   - The Perps panel's loading skeletons.
   - A frozen landing frame held to fill the narration.
7. **Captions are translucent.** The rules call for opaque captions.
8. **No value statement at the end.** It ends on a tagline, not on what was achieved: trades made, fees earned, markets opened.

## What it did well
- It is real: every scene is the live app on Monad testnet, with real transactions.
- The two-timer receipt and the live commit-state strip are clear Monad-native moments.
- The passkey account (Mera) and the P256 proof are shown working.

## What the rebuild changes
- Capture at phone size and full resolution (CDP screencast at 2x), then compose 1920×1080 with the phone on one side and a live "what just happened" panel on the other: the step, the measured number, the sponsor and the tx. The frame is full and readable.
- The first 15 s are real app footage that states the problem and the user. No slide intro in the submission cut.
- Full flow:
  - **sign-up:** a passkey account (Mera);
  - **trading:** faucet, a buy and its receipt with both timers;
  - **creating:** launch a post (Pinata, one tx), then the creator's earnings;
  - **Kuru:** the graduated coin's book and a limit order;
  - **Perpl + Agora:** AUSD margin, open, close, then the Risk view;
  - **Chainlink CRE:** the attested NAV;
  - **Envio:** the indexer-backed holders;
  - **Monad:** staking read from Monad's precompile, gas and txpool details.
- Waits are cut or sped up with a visible "×2" tag. Captions are opaque.
