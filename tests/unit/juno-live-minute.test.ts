import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/juno/registry", () => ({ listPools: async () => [] }));

import { recallContent, warmContent } from "@/lib/juno/ipfs-cache";
import { stillCids } from "@/lib/juno/media-warm";
import { clearConfirmations, recentConfirmations, recordConfirmation } from "@/lib/juno/speed-log";

/**
 * The live first minute: the confirmation times the landing shows, and the
 * pictures the server fetches before a visitor opens the feed.
 */
describe("speed log", () => {
  beforeEach(() => clearConfirmations());

  it("has nothing to say before anything was submitted", () => {
    expect(recentConfirmations()).toBeNull();
  });

  it("reports the latest and the median of the last twenty", () => {
    for (const ms of [900, 300, 310, 320]) recordConfirmation(ms, 1, 1_000);
    expect(recentConfirmations()).toMatchObject({ lastMs: 320, medianMs: 315, samples: 4 });
    for (let i = 0; i < 30; i++) recordConfirmation(400 + i, 2, 2_000);
    const summary = recentConfirmations()!;
    expect(summary.samples).toBe(20);
    expect(summary.lastMs).toBe(429);
    expect(summary.medianMs).toBe(420);
  });

  it("ignores a time that is not one", () => {
    recordConfirmation(Number.NaN, 1);
    recordConfirmation(-5, 1);
    expect(recentConfirmations()).toBeNull();
  });
});

const PHOTO = "QmVFD9q6frrWy5j1jeoYDySyXt7wZsr3i93MVxy1x4eWDX";
const VIDEO = "QmdXCVRYkZnBDJuPW4KyAQgdbcBJuezY5aW3wsosYtkxhe";
const POSTER = "QmUnwbLu1e8gqvqMjuytmcbKdjTAqn55az9ZUcmh1PdW8J";

describe("stillCids", () => {
  it("takes every poster and every image, and never a video", () => {
    const cids = stillCids([
      { mediaUrl: `ipfs://${PHOTO}`, posterUrl: null, mediaMime: "image/jpeg" },
      { mediaUrl: `ipfs://${VIDEO}`, posterUrl: `ipfs://${POSTER}`, mediaMime: "video/mp4" },
      { mediaUrl: `ipfs://${PHOTO}`, posterUrl: `ipfs://${PHOTO}`, mediaMime: "image/jpeg" },
    ]);
    expect(cids.sort()).toEqual([PHOTO, POSTER].sort());
  });
});

describe("warmContent", () => {
  const response = (body: string, type: string, status = 200) =>
    new Response(body, { status, headers: { "content-type": type, "content-length": String(body.length) } });

  it("skips a gateway's error page and keeps the content from the next one", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return calls === 1 ? response("<html>busy</html>", "text/html") : response("JPEGBYTES", "image/jpeg");
    }) as unknown as typeof fetch;
    expect(await warmContent(POSTER, fetchImpl)).toBe(true);
    expect(recallContent(POSTER)?.type).toBe("image/jpeg");
    // Held now: no second fetch.
    expect(await warmContent(POSTER, fetchImpl)).toBe(true);
    expect(calls).toBe(2);
  });

  it("refuses what is not a content hash, and reports a miss when no gateway serves it", async () => {
    expect(await warmContent("not-a-cid")).toBe(false);
    const fetchImpl = (async () => response("", "image/jpeg", 504)) as unknown as typeof fetch;
    expect(await warmContent(VIDEO, fetchImpl)).toBe(false);
  });
});
