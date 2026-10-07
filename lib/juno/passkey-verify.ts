/**
 * Passkeys on chain: a WebAuthn signature checked by Monad's P256 precompile.
 *
 * A passkey signs with P-256 (ES256). Monad has the EIP-7951 / RIP-7212
 * precompile at 0x…0100: 160 bytes in (hash ‖ r ‖ s ‖ x ‖ y), 32 bytes of
 * 0x…01 out when the signature is valid, nothing when it is not. Juno sends a
 * passkey's assertion there with `eth_call`. Its validity is decided by the
 * chain's own code, the same call a contract would make, and the same answer
 * on a local fork (the precompile is part of the EVM, not cloned state) as on
 * Monad.
 *
 * What a WebAuthn assertion signs is sha256(authenticatorData ‖
 * sha256(clientDataJSON)), and clientDataJSON carries the challenge, so the
 * check also proves the passkey answered *this* challenge.
 */
import { createHash } from "node:crypto";

export const P256_PRECOMPILE = "0x0000000000000000000000000000000000000100" as const;

const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
export function bytesOf(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^([0-9a-fA-F]{2})*$/.test(clean)) throw new Error("not hex");
  return new Uint8Array(Buffer.from(clean, "hex"));
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

/** What the authenticator signed: sha256(authenticatorData ‖ sha256(clientDataJSON)). */
export function webauthnDigest(authenticatorData: Uint8Array, clientDataJSON: Uint8Array): Uint8Array {
  const joined = new Uint8Array(authenticatorData.length + 32);
  joined.set(authenticatorData, 0);
  joined.set(sha256(clientDataJSON), authenticatorData.length);
  return sha256(joined);
}

/**
 * An ASN.1 DER ECDSA signature (what WebAuthn returns) as 32-byte r and s.
 * Throws on anything that is not one.
 */
export function derToRS(der: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  let at = 0;
  const take = (expected: number) => {
    if (der[at] !== expected) throw new Error("not a DER ECDSA signature");
    at++;
  };
  take(0x30);
  const total = der[at++];
  if (total + 2 !== der.length) throw new Error("DER length mismatch");
  const integer = () => {
    take(0x02);
    const length = der[at++];
    let value = der.slice(at, at + length);
    at += length;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length > 32) throw new Error("DER integer too long");
    const out = new Uint8Array(32);
    out.set(value, 32 - value.length);
    return out;
  };
  const r = integer();
  const s = integer();
  if (at !== der.length) throw new Error("trailing bytes after the DER signature");
  return { r, s };
}

/** The precompile's 160-byte input, as hex. */
export function p256Input(digest: Uint8Array, r: Uint8Array, s: Uint8Array, x: Uint8Array, y: Uint8Array): `0x${string}` {
  for (const part of [digest, r, s, x, y]) if (part.length !== 32) throw new Error("each P256 input part is 32 bytes");
  return `0x${hexOf(digest)}${hexOf(r)}${hexOf(s)}${hexOf(x)}${hexOf(y)}`;
}

/** The precompile's answer: 0x…01 means valid; empty means not. */
export function precompileSaysValid(answer: string | undefined | null): boolean {
  return typeof answer === "string" && /^0x0{63}1$/.test(answer);
}

/**
 * A P-256 public key from a passkey: SPKI DER (what `getPublicKey()` returns,
 * 91 bytes for P-256) or a raw 65-byte uncompressed point.
 */
export function p256PointOf(key: Uint8Array): { x: Uint8Array; y: Uint8Array } {
  const point = key.length === 65 ? key : key.slice(key.length - 65);
  if (point[0] !== 0x04 || point.length !== 65) throw new Error("not an uncompressed P-256 public key");
  return { x: point.slice(1, 33), y: point.slice(33, 65) };
}

/** base64url, as WebAuthn writes the challenge into clientDataJSON. */
export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The parts of clientDataJSON that matter: a `webauthn.get` ceremony over
 * this challenge. Throws with a sentence when either is wrong.
 */
export function checkClientData(clientDataJSON: Uint8Array, challenge: Uint8Array): void {
  let data: { type?: unknown; challenge?: unknown };
  try {
    data = JSON.parse(Buffer.from(clientDataJSON).toString("utf8"));
  } catch {
    throw new Error("clientDataJSON is not JSON");
  }
  if (data.type !== "webauthn.get") throw new Error("That is not a passkey sign-in assertion.");
  if (data.challenge !== base64url(challenge)) throw new Error("The passkey answered a different challenge.");
}

/** The text the wallet signs to say this passkey key is its own. Shared with the app. */
export function passkeyLinkMessage(wallet: string, keyHex: string, challengeHex: string): string {
  return `Juno passkey on Monad\nWallet: ${wallet}\nPasskey key: ${keyHex}\nChallenge: ${challengeHex}`;
}
