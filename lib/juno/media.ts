/**
 * IPFS media addresses.
 *
 * The registry stores content addresses (`ipfs://<cid>` or a bare CID), never
 * a gateway URL — gateways die and rate-limit, and every row that stored one
 * had to be rewritten when gateway.pinata.cloud started returning 429s. The
 * app serves media through its own `/api/ipfs/<cid>` route, which fails over
 * across gateways server-side, so a gateway's bad day is not the demo's bad
 * day. Wallets and explorers, which cannot reach this app's routes, get a
 * plain gateway URL baked into the pinned metadata instead — that is the one
 * place a gateway URL is still written.
 */

const CID_V0 = /^[1-9A-HJ-NP-Za-km-z]{44,46}$/;
const CID_V1 = /^b[a-z2-7]{58}$/;

/**
 * Pull a CID out of any form an address is stored in: `ipfs://…`, a gateway
 * URL, a bare CID, or a `/api/ipfs/…` route URL. Null for anything else —
 * a non-IPFS URL (or an identicon data-URI) is passed through untouched by
 * `mediaSrc`.
 */
export function mediaCid(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const forms = [
    trimmed.startsWith("ipfs://") ? trimmed.slice(7) : null,
    trimmed.includes("/ipfs/") ? trimmed.split("/ipfs/")[1] : null,
    trimmed.startsWith("/api/ipfs/") ? trimmed.slice("/api/ipfs/".length) : null,
    trimmed,
  ].filter((form): form is string => Boolean(form));

  for (const form of forms) {
    // A gateway URL can carry a path after the CID (`/ipfs/<cid>/file.mp4`)
    // — the CID is the first segment either way.
    const candidate = form.split("/")[0].split("?")[0];
    if (CID_V0.test(candidate) || CID_V1.test(candidate)) return candidate;
  }
  return null;
}

/** What the app renders with. Bare CID → our own route; anything else through. */
export function mediaSrc(value: string | null | undefined): string | null {
  if (!value) return null;
  const cid = mediaCid(value);
  if (cid) return `/api/ipfs/${cid}`;
  return value;
}

/** Image or video, decided by the stored mime type — never by the URL's tail. */
export function mediaKind(mime: string | null | undefined): "image" | "video" {
  return mime?.startsWith("video") ? "video" : "image";
}

/** A public URL for consumers outside this app (wallets, explorers, metadata). */
export function gatewayUrlFor(value: string | null | undefined): string {
  const cid = mediaCid(value);
  if (cid) {
    return `${process.env.NEXT_PUBLIC_IPFS_GATEWAY?.replace(/\/$/, "") || "https://gateway.pinata.cloud/ipfs"}/${cid}`;
  }
  return value ?? "";
}
