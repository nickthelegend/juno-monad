"""
Voiceover for the Juno product demo, one clip per chapter, with Kokoro TTS
(male voice `am_michael`). Writes vo/<id>.wav and vo/durations.json.

    python3 scripts/demo/vo.py .juno/video/final/vo

The narration lives here and nowhere else: vo_local.py and vo_eleven.py
import LINES, and docs/FILM.md quotes it. Every sentence is something
JUNO.md or PLAN.md records as built and checked; c09 and c10 only become true
once a Privy login is recorded and the testnet deployment is verified, and
the film leaves them out until then (docs/FILM.md).
"""
import json
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

MODEL = "/Volumes/Extreme SSD/Projects/swipe-fit/.cache/kokoro/kokoro-v1.0.onnx"
VOICES = "/Volumes/Extreme SSD/Projects/swipe-fit/.cache/kokoro/voices-v1.0.bin"
VOICE = "am_michael"

LINES = {
    "intro": "This is Juno, on Monad testnet, with no real money. Every post is a market.",
    "problem": "Creators get paid by platforms, months later, in ad money. Their first fans get nothing. On Juno, every post is its own market, and its creator earns on every trade.",
    "c01": "Every photo and reel on Juno is its own token, on its own bonding curve. The feed and the reels show each market's value, and how close it is to graduating.",
    "c02": "A buy happens mid-scroll. The server builds the transaction, the wallet in the app signs it, and the server waits for the receipt. The sheet shows how long that took, and links it on MonadVision.",
    "c03": "Posting is launching. Pick a photo, name it, pick a curve shape. One transaction deploys the token, opens its curve and makes the creator's first buy, and the launch log shows each receipt.",
    "c04": "Every trade pays a fee, and most of it builds up for the creator. Only the creator gets the Claim button, and one transaction pays it out.",
    "c05": "The token chip switches a buy from spend to get exactly. The contract delivers exactly that many tokens, never above the stated cost, and refunds the rest.",
    "c06": "When a curve fills, anyone can graduate it. Its reserves move into the coin's Uniswap v2 pair at the curve's final price, locked for good, and Juno keeps trading it there through its own router.",
    "c07": "Or the creator picks Kuru. Graduation then opens the coin's own market on Kuru's order book, seeds its vault at the curve's final price, and trading carries on there.",
    "c08": "The same curves make Pre-IPO trackers for OpenAI, Kalshi and SpaceX, marked against Tessera. When a curve drifts outside its band, the trade sheet says so before anything is signed.",
    "c09": "On a phone, sign-in can be Privy. An email and a six-digit code make an embedded wallet, and it signs the same server-built transactions.",
    "c10": "Every contract is verified on MonadVision, and every step you saw is a real transaction on Monad testnet.",
    "stack": "Under the hood, one Expo app runs on iOS, Android and the web. The server builds every transaction, and the wallet signs it. Juno's own Solidity contracts run the curves and graduation, and Envio indexes the history.",
    "outro": "Juno. Every post is a market. Built on Monad.",
}

if __name__ == "__main__":
    out = sys.argv[1]
    kokoro = Kokoro(MODEL, VOICES)
    durations = {}
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    old = json.load(open(f"{out}/durations.json")) if only else {}
    durations.update(old)
    for key, text in LINES.items():
        if only and key not in only:
            continue
        samples, rate = kokoro.create(text, voice=VOICE, speed=1.22, lang="en-us")
        sf.write(f"{out}/{key}.wav", samples, rate)
        durations[key] = round(len(samples) / rate, 2)
        print(key, durations[key])
    json.dump(durations, open(f"{out}/durations.json", "w"), indent=1)
