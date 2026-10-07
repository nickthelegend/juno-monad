/**
 * At server start: warm the feed's pictures in the background.
 *
 * `register` must finish before the server takes requests, so the warm-up is
 * only scheduled here, never awaited. The landing page also asks for it
 * (`/api/juno/stats`); this covers someone whose first visit is a deep link
 * into the feed. Node.js only, and never during `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { warmListedMedia } = await import("./lib/juno/media-warm");
  const timer = setTimeout(() => warmListedMedia(), 3_000);
  timer.unref?.();
}
