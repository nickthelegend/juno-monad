import { describe, expect, it } from "vitest";

import { check, clientIp, rateLimit } from "@/lib/rate-limit";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("clientIp", () => {
  it("does not trust the first x-forwarded-for entry, which the client writes", () => {
    // The client sent "1.1.1.1"; the proxy appended the address it saw.
    expect(clientIp(headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("takes a header a platform proxy sets over x-forwarded-for", () => {
    expect(clientIp(headers({ "fly-client-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.4");
    expect(clientIp(headers({ "cf-connecting-ip": "198.51.100.5", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.5");
    expect(clientIp(headers({ "x-vercel-forwarded-for": "198.51.100.6, 10.0.0.1" }))).toBe("198.51.100.6");
  });

  it("says unknown when nothing names an address", () => {
    expect(clientIp(headers({}))).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});

describe("check", () => {
  it("allows the limit, then refuses with a retry time", () => {
    const key = `test:${Math.random()}`;
    expect(check(key, 2, 60_000).ok).toBe(true);
    expect(check(key, 2, 60_000).ok).toBe(true);
    const third = check(key, 2, 60_000);
    expect(third.ok).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
  });
});

describe("rateLimit", () => {
  it("answers 429 with a sentence and CORS headers once an address is over", async () => {
    const request = new Request("http://api.test/api/juno/upload", {
      method: "POST",
      headers: { "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 250)}` },
    });
    for (let i = 0; i < 20; i++) expect(rateLimit(request, "upload")).toBeNull();
    const refused = rateLimit(request, "upload");
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get("access-control-allow-origin")).toBeTruthy();
    expect((await refused!.json()).error).toMatch(/Too many uploads/);
  });
});
