import "server-only";

import { warmContent } from "./ipfs-cache";
import { mediaCid } from "./media";
import { listPools } from "./registry";

/**
 * Warm the picture cache for every listed coin.
 *
 * A first visit used to fetch each IPFS picture through a public gateway,
 * about six seconds apiece, so the feed opened on blank cards and black story
 * rings. The landing page asks for this as it loads (`/api/juno/stats`), so
 * the pictures are in memory by the time someone presses Get Started. Images
 * and reel posters only; videos stream on demand. At most once every ten
 * minutes per process, three fetches at a time, never awaited by a request.
 */
const EVERY_MS = 10 * 60_000;
const WIDTH = 3;

const shared = globalThis as typeof globalThis & { __junoMediaWarm?: { at: number; running: boolean } };

export function warmListedMedia(now = Date.now()): void {
  shared.__junoMediaWarm ??= { at: 0, running: false };
  const state = shared.__junoMediaWarm;
  if (state.running || now - state.at < EVERY_MS) return;
  state.running = true;
  state.at = now;
  void run()
    .catch(() => undefined)
    .finally(() => {
      state.running = false;
    });
}

/** The CIDs a feed shows for these rows: each poster, and each image (a video is not a still). */
export function stillCids(rows: Array<{ mediaUrl: string | null; posterUrl: string | null; mediaMime: string | null }>): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const poster = mediaCid(row.posterUrl);
    if (poster) out.add(poster);
    if (!row.mediaMime?.startsWith("video")) {
      const media = mediaCid(row.mediaUrl);
      if (media) out.add(media);
    }
  }
  return [...out];
}

async function run(): Promise<void> {
  const queue = stillCids(await listPools(60, { listedOnly: true }));
  async function worker() {
    for (let cid = queue.shift(); cid; cid = queue.shift()) await warmContent(cid);
  }
  await Promise.all(Array.from({ length: WIDTH }, worker));
}
