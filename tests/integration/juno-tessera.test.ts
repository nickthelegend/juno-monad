import { describe, expect, it } from "vitest";

import { isTesseraRef, tesseraRef, tesseraToken, tesseraTokens } from "@/lib/juno/tessera";

/**
 * Live checks against Tessera's public API.
 *
 * Tessera's mark is the reference an `ipo-book` curve on Juno is measured
 * against for a company Pyth has no feed for. Juno on Monad never holds or
 * reads Tessera's own token — it reads the published mark over HTTP — so the
 * only thing worth asserting is that the API answers in the shape the reader
 * expects.
 *
 * Network-tolerant on purpose: a third-party API being down is reported, not
 * failed on. What *is* failed on is an answer in a shape the reader cannot use.
 */
describe("tessera", () => {
  it("reads every published T-token with a usable mark", async () => {
    const tokens = await tesseraTokens();
    if (tokens.length === 0) {
      console.warn("INCONCLUSIVE — Tessera's API returned nothing (down or unreachable).");
      return;
    }

    for (const token of tokens) {
      expect(token.id).toMatch(/^T-/);
      expect(token.markPrice).toBeGreaterThan(0);
      expect(token.markValuation).toBeGreaterThan(0);
      expect(token.holders).toBeGreaterThanOrEqual(0);
      // Supply comes from a second endpoint and may legitimately be missing —
      // but never NaN leaking into a valuation.
      expect(token.supply === null || Number.isFinite(token.supply)).toBe(true);
    }
    console.info(`TESSERA: ${tokens.map((t) => `${t.id} $${t.markPrice}`).join(", ")}`);
  });

  it("resolves one token by id, case-insensitively and by reference, and refuses an unknown one", async () => {
    const tokens = await tesseraTokens();
    if (tokens.length === 0) {
      console.warn("INCONCLUSIVE — Tessera's API returned nothing (down or unreachable).");
      return;
    }
    const [first] = tokens;
    expect((await tesseraToken(first.id.toLowerCase()))?.id).toBe(first.id);
    expect((await tesseraToken(tesseraRef(first.id)))?.id).toBe(first.id);
    expect(await tesseraToken("T-NotAThing")).toBeNull();
  });

  it("tells a Tessera reference from a Pyth feed id", () => {
    expect(isTesseraRef(tesseraRef("T-OpenAI"))).toBe(true);
    expect(isTesseraRef("49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688")).toBe(false);
    expect(isTesseraRef(null)).toBe(false);
  });
});
