import { describe, expect, it } from "vitest";

import { mediaKind, mediaSrc } from "@/lib/juno/media";

/**
 * Where the app loads a coin's picture from.
 *
 * Every stored form of an IPFS reference becomes Juno's own `/api/ipfs/<cid>`
 * route. A raw `ipfs://` row handed to the app as-is turned into
 * `<api host>ipfs://…` there and drew nothing, which is how every holding on a
 * profile showed a blank square until 7 Oct.
 */
const CID = "QmVFD9q6frrWy5j1jeoYDySyXt7wZsr3i93MVxy1x4eWDX";

describe("mediaSrc", () => {
  it("serves ipfs:// rows, gateway URLs and bare CIDs through Juno's own route", () => {
    expect(mediaSrc(`ipfs://${CID}`)).toBe(`/api/ipfs/${CID}`);
    expect(mediaSrc(`https://gateway.pinata.cloud/ipfs/${CID}`)).toBe(`/api/ipfs/${CID}`);
    expect(mediaSrc(`https://gateway.pinata.cloud/ipfs/${CID}/clip.mp4`)).toBe(`/api/ipfs/${CID}`);
    expect(mediaSrc(CID)).toBe(`/api/ipfs/${CID}`);
  });

  it("passes other URLs through, and nothing stays nothing", () => {
    expect(mediaSrc("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
    expect(mediaSrc(null)).toBeNull();
    expect(mediaSrc("")).toBeNull();
  });

  it("decides image or video by the stored mime type", () => {
    expect(mediaKind("video/mp4")).toBe("video");
    expect(mediaKind("image/jpeg")).toBe("image");
    expect(mediaKind(null)).toBe("image");
  });
});
