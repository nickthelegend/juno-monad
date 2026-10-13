# The demo video

`docs/demo/juno-metropolis.mp4`, 2:21, 1920×1080, with captions burned in plus an `.srt`:
- **Intro:** a 35 s motion-graphics intro in Juno's palette;
- **Demo:** a live recording of the hosted app on Monad testnet, with real transactions and a visible cursor;
- **Outro:** product name, tagline and live URL.

The pipeline, run from this folder:
1. `node tts.mjs`: ElevenLabs narration, one call per line (`script.json`), with word timings. It re-voices only lines that changed.
2. `node capture.mjs`: one continuous Playwright take of the live app. A passkey account (Chrome's virtual authenticator) gets faucet MON and buys on Kuru. Then the receipt and its card, the P256 proof, search to the Kuru coin, Perpl with Agora AUSD (faucet, deposit, 2x long, close), and the OpenAI tracker's CRE-attested NAV. The take writes `work/marks.json`.
3. `node render_graphics.mjs`: renders `graphics.html` frame by frame into the intro and outro, timed to the voice.
4. `node assemble.mjs`: cuts each scene to its line (at most 1.6× speed; 2.5× for the Perpl scene), adds the LIVE · MONAD TESTNET tag and caption overlays, and mixes the voice at −16 LUFS.

The take spends real testnet MON: one faucet drip, a 0.1 MON buy and Perpl gas.
