import { p256 } from "@noble/curves/p256";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  base64url,
  checkClientData,
  derToRS,
  p256Input,
  p256PointOf,
  precompileSaysValid,
  webauthnDigest,
} from "@/lib/juno/passkey-verify";

/**
 * A passkey assertion as a browser produces it, checked the way Monad's P256
 * precompile will check it. The reference here is @noble/curves; the
 * precompile itself answered 0x…01 for this construction on testnet on 7 Oct.
 */
const sha = (b: Uint8Array) => new Uint8Array(createHash("sha256").update(b).digest());

function assertion(challenge: Uint8Array) {
  const sk = p256.utils.randomPrivateKey();
  const point = p256.getPublicKey(sk, false);
  const authenticatorData = new Uint8Array(37).fill(7);
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.get", challenge: base64url(challenge), origin: "http://localhost:8183" }),
  );
  const digest = sha(new Uint8Array([...authenticatorData, ...sha(clientDataJSON)]));
  const der = p256.sign(digest, sk, { prehash: false }).toDERRawBytes();
  return { point, authenticatorData, clientDataJSON, der, digest };
}

describe("passkey assertion → P256 precompile input", () => {
  it("computes the digest a WebAuthn assertion signs, and a valid 160-byte input", () => {
    const challenge = new Uint8Array(32).fill(3);
    const a = assertion(challenge);
    expect(webauthnDigest(a.authenticatorData, a.clientDataJSON)).toEqual(a.digest);
    const { r, s } = derToRS(a.der);
    const { x, y } = p256PointOf(a.point);
    const input = p256Input(a.digest, r, s, x, y);
    expect(input.length).toBe(2 + 320);
    // The same check the precompile makes, by a reference implementation.
    const sig = new p256.Signature(BigInt(`0x${Buffer.from(r).toString("hex")}`), BigInt(`0x${Buffer.from(s).toString("hex")}`));
    expect(p256.verify(sig, a.digest, a.point, { prehash: false, lowS: false })).toBe(true);
  });

  it("reads a public key from SPKI DER (as getPublicKey() returns) or a raw point", () => {
    const point = p256.getPublicKey(p256.utils.randomPrivateKey(), false);
    const spki = new Uint8Array([...new Uint8Array(26).fill(0x30), ...point]);
    expect(p256PointOf(spki)).toEqual(p256PointOf(point));
    expect(() => p256PointOf(new Uint8Array(64))).toThrow();
  });

  it("parses DER integers with a leading zero, and refuses what is not DER", () => {
    for (let i = 0; i < 20; i++) {
      const { der } = assertion(new Uint8Array(32));
      const { r, s } = derToRS(der);
      expect(r.length).toBe(32);
      expect(s.length).toBe(32);
    }
    expect(() => derToRS(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("checks the ceremony and the challenge in clientDataJSON", () => {
    const challenge = new Uint8Array(32).fill(9);
    const { clientDataJSON } = assertion(challenge);
    expect(() => checkClientData(clientDataJSON, challenge)).not.toThrow();
    expect(() => checkClientData(clientDataJSON, new Uint8Array(32).fill(1))).toThrow(/different challenge/);
    const created = new TextEncoder().encode(JSON.stringify({ type: "webauthn.create", challenge: base64url(challenge) }));
    expect(() => checkClientData(created, challenge)).toThrow(/not a passkey sign-in/);
  });

  it("reads the precompile's answer: 0x…01 is valid, empty is not", () => {
    expect(precompileSaysValid(`0x${"0".repeat(63)}1`)).toBe(true);
    expect(precompileSaysValid("0x")).toBe(false);
    expect(precompileSaysValid(null)).toBe(false);
  });
});
