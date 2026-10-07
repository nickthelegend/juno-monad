import { junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { warmListedMedia } from "@/lib/juno/media-warm";
import { loadStats } from "@/lib/juno/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /stats` — the live figures on the landing page. Also starts warming
 * the feed's pictures, since a visitor who is reading this is about to open
 * the feed.
 */
export async function GET() {
  return junoRead(async () => {
    warmListedMedia();
    return junoJson(await loadStats());
  });
}
