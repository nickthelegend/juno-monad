"""
Cut each chapter's phone screen out of the footage and speed it to fit that
chapter's narration (never slower than real time, at most 3x).

    python3 scripts/demo/clips.py .juno/video/final/hf .juno/video/final/vo [c01,c05]

With a list of chapter ids, only those clips are rebuilt and the rest of
plan.json is kept.

Reads the framed takes in .juno/video/full/, crops the screen (the phone body
is redrawn in HTML so a shape can sit behind it), writes hf/assets/clips/<id>.mp4
and hf/plan.json. A source named `raw/<file>` is a bare recording in
.juno/video/raw/ — a web take from record-web.mjs, or an iOS Simulator
recording — already just the screen, so it is scaled rather than cropped.
A chapter with more than one source plays them one after the other.

A chapter in OPTIONAL is left out of plan.json when its footage does not
exist, and build_hf.py then leaves it out of the film; any other missing
footage stops the build.
"""
import json
import os
import subprocess
import sys

HF, VO = sys.argv[1], sys.argv[2]
FULL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".juno", "video", "full")
MAX_SPEED = 3.0
PAD = 1.8  # seconds of picture around the narration

# (chapter, kind, sources). Phone takes come from record-web.mjs (the bare
# screen, in raw/), except c09, which is an iOS Simulator recording of a real
# Privy sign-in; browser takes are desktop recordings; a terminal chapter has
# no clip, only a length.
CHAPTERS = [
    ("c01", "phone", ["raw/01-feed"]), ("c02", "phone", ["raw/02-buy"]), ("c03", "phone", ["raw/03-launch"]),
    ("c04", "phone", ["raw/04-claim"]), ("c05", "phone", ["raw/05-exact"]), ("c06", "phone", ["raw/06-graduated-v2"]),
    ("c07", "phone", ["raw/07-kuru"]), ("c08", "phone", ["raw/08-preipo", "raw/08-tracker"]),
    ("c09", "phone", ["raw/09-privy"]), ("c10", "browser", ["raw/10-explorer"]),
]
# Only in the film when it was really recorded: a Privy login needs a person
# with a real account (docs/FILM.md).
OPTIONAL = {"c09"}


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return float(out)


vo = json.load(open(f"{VO}/durations.json"))
only = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None
plan = json.load(open(f"{HF}/plan.json")) if only else {}
for cid, kind, parts in CHAPTERS:
    if only and cid not in only:
        continue
    if kind == "term":
        length = round(vo[cid] + PAD + 1.2, 2)
        plan[cid] = {"clip": 0, "len": length, "speed": 1, "vo": vo[cid]}
        print(cid, plan[cid])
        continue
    raw = parts[0].startswith("raw/")
    sources = [os.path.normpath(f"{FULL}/../{p}.mp4" if p.startswith("raw/") else f"{FULL}/{p}.mp4") for p in parts]
    missing = [s for s in sources if not os.path.exists(s)]
    if missing:
        if cid in OPTIONAL:
            plan.pop(cid, None)
            print(cid, "left out: no footage at", ", ".join(missing))
            continue
        sys.exit(f"{cid}: no footage at {', '.join(missing)} (docs/FILM.md, step 1)")
    clip = sum(duration(s) for s in sources)
    length = round(max(vo[cid] + PAD, clip / MAX_SPEED), 2)
    speed = max(clip / length, 1.0)
    inputs = [arg for s in sources for arg in ("-i", s)]
    n = len(sources)
    size = "1640:1024" if kind == "browser" else "402:874"
    if n > 1:
        # concat wants one size. Framed takes share one; bare takes need not (a
        # web take is 393x852, a simulator recording 1206x2622), so they are
        # brought to the clip's size first.
        each = "".join(f"[{i}:v]scale={size}:flags=lanczos,setsar=1[s{i}];" if raw else f"[{i}:v]null[s{i}];"
                       for i in range(n))
        join = each + "".join(f"[s{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[c];"
    else:
        join = "[0:v]null[c];"
    crop = "" if raw else "crop=766:1666:157:127,"
    graph = (f"{join}[c]{crop}setpts=PTS/{speed:.4f},fps=30,"
             f"scale={size}:flags=lanczos,tpad=stop_mode=clone:stop_duration={length + 1:.2f}[v]")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", graph, "-map", "[v]",
                    "-t", f"{length + 0.6:.2f}", "-an", "-c:v", "libx264", "-crf", "17", "-preset", "medium",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", f"{HF}/assets/clips/{cid}.mp4"], check=True)
    plan[cid] = {"clip": round(clip, 2), "len": length, "speed": round(speed, 2), "vo": vo[cid]}
    print(cid, plan[cid])
json.dump(plan, open(f"{HF}/plan.json", "w"), indent=1)
print("chapters total", round(sum(p["len"] for p in plan.values()), 1))
