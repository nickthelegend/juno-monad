/**
 * Content this server already holds, by IPFS hash.
 *
 * A creator's photo is uploaded here, pinned to Pinata, and then asked for
 * again through `/api/ipfs/[cid]` a second later by the feed. Right after a
 * pin, public gateways often do not have the content yet: they time out, rate
 * limit, or answer with an HTML error page, and the browser blocks any of
 * those as an image. The creator's first sight of their own post was an empty
 * box. The upload route has the bytes in hand, so it leaves them here, and the
 * gateway route serves them without asking anyone.
 *
 * It doubles as a cache for what the gateway route fetches. Content is
 * addressed by its hash, so an entry can never be stale; the only question is
 * memory, which is capped. Kept on `globalThis` because each Next route is
 * bundled on its own and would otherwise get its own copy of this module.
 */

type Entry = { bytes: Uint8Array; type: string };
type Store = { entries: Map<string, Entry>; total: number };

/** Whole-cache ceiling. Oldest entries go first. */
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
/** Photos and posters fit; a long video streams from the gateway instead. */
export const MAX_CACHED_BYTES = 12 * 1024 * 1024;

const shared = globalThis as typeof globalThis & { __junoIpfsCache?: Store };

function store(): Store {
  shared.__junoIpfsCache ??= { entries: new Map(), total: 0 };
  return shared.__junoIpfsCache;
}

export function rememberContent(cid: string, bytes: Uint8Array, type: string): void {
  if (bytes.byteLength > MAX_CACHED_BYTES) return;
  const s = store();
  const existing = s.entries.get(cid);
  if (existing) {
    s.total -= existing.bytes.byteLength;
    s.entries.delete(cid);
  }
  s.entries.set(cid, { bytes, type });
  s.total += bytes.byteLength;
  for (const [key, entry] of s.entries) {
    if (s.total <= MAX_TOTAL_BYTES) break;
    s.entries.delete(key);
    s.total -= entry.bytes.byteLength;
  }
}

export function recallContent(cid: string): Entry | null {
  const s = store();
  const entry = s.entries.get(cid);
  if (!entry) return null;
  // Most recently used goes to the back of the eviction queue.
  s.entries.delete(cid);
  s.entries.set(cid, entry);
  return entry;
}
