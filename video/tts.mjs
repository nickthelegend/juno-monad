// ElevenLabs narration, one request per line, with character timestamps.
// Writes work/vo/<id>.mp3 and work/vo/lines.json. Re-voices only lines whose text or voice changed.
//   node tts.mjs            node tts.mjs --audition <voiceId> "<text>"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const env = readFileSync("/Volumes/Extreme SSD/Projects/metropolis-funding/keys/api-keys.env", "utf8");
const KEY = env.match(/^ELEVENLABS_API_KEY=(.*)$/m)?.[1]?.trim();
if (!KEY) throw new Error("no ELEVENLABS_API_KEY");
mkdirSync("work/vo", { recursive: true });

async function speak(voice, model, text) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.25, use_speaker_boost: true } }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Characters with times → words with start/end seconds. */
function words(alignment) {
  const out = [];
  let cur = null;
  alignment.characters.forEach((ch, i) => {
    const s = alignment.character_start_times_seconds[i];
    const e = alignment.character_end_times_seconds[i];
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = null; } return; }
    if (!cur) cur = { word: "", start: s, end: e };
    cur.word += ch; cur.end = e;
  });
  if (cur) out.push(cur);
  return out;
}

if (process.argv[2] === "--audition") {
  const [, , , voice, text] = process.argv;
  const j = await speak(voice, "eleven_multilingual_v2", text);
  writeFileSync(`work/vo/audition-${voice}.mp3`, Buffer.from(j.audio_base64, "base64"));
  console.log(`work/vo/audition-${voice}.mp3`);
  process.exit(0);
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SCRIPT = arg("--script", "script.json"), VO = arg("--out", "work/vo");
mkdirSync(VO, { recursive: true });
const spec = JSON.parse(readFileSync(SCRIPT, "utf8"));
const manifest = `${VO}/lines.json`;
const prev = existsSync(manifest) ? Object.fromEntries(JSON.parse(readFileSync(manifest, "utf8")).map((l) => [l.id, l])) : {};
const out = [];
let chars = 0;
for (const sc of spec.scenes) {
  for (const [i, text] of sc.lines.entries()) {
    const id = `${sc.id}_${i + 1}`;
    const file = `${VO}/${id}.mp3`;
    const old = prev[id];
    if (old && old.text === text && old.voice === spec.voice && existsSync(file)) { out.push(old); continue; }
    const j = await speak(spec.voice, spec.model, text);
    writeFileSync(file, Buffer.from(j.audio_base64, "base64"));
    const w = words(j.alignment);
    chars += text.length;
    out.push({ id, scene: sc.id, kind: sc.kind, text, voice: spec.voice, file, words: w, seconds: w.at(-1).end });
    console.log(`${id} ${w.at(-1).end.toFixed(2)}s ${text.slice(0, 60)}`);
  }
}
writeFileSync(manifest, JSON.stringify(out, null, 2));
console.log(`${out.length} lines, ${out.reduce((t, l) => t + l.seconds, 0).toFixed(1)} s of speech, ${chars} characters voiced now`);
