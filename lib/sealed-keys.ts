import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Versioned encryption keys for secrets the server holds — today, only the
 * testnet faucet's private key.
 *
 * Deliberately NOT marked "server-only": scripts need the exact same key
 * handling as the app, and a second copy of this logic is how you get two
 * subtly different implementations of the thing guarding a key. It stays safe
 * because it only reads non-NEXT_PUBLIC env vars, which are simply absent in a
 * browser — an accidental client import throws rather than leaking.
 *
 * With a single unversioned secret, rotation is impossible: you cannot tell
 * which rows were sealed with which key, so a leaked secret can never be
 * retired. So each sealed value records the key version it was sealed with,
 * and several versions can be readable at once. Rotation becomes: add a new
 * version, make it current, re-seal, then drop the old secret.
 *
 * Env:
 *   JUNO_KEY_SECRET        version 1, a base64-encoded 32-byte key
 *   JUNO_KEY_SECRET_V2     version 2, and so on
 *   JUNO_KEY_VERSION       which version to seal NEW data with
 */

const LEGACY_ENV = "JUNO_KEY_SECRET";

function parseKey(raw: string, label: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${label} must be a base64-encoded 32-byte key`);
  }
  return key;
}

/** Every readable key, by version. */
export function loadKeys(): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();

  // Version 1 is the original secret — keep reading it forever, or anything
  // sealed before a rotation becomes permanently unopenable.
  const legacy = process.env[LEGACY_ENV];
  if (legacy) keys.set(1, parseKey(legacy, LEGACY_ENV));

  // Additional versions: JUNO_KEY_SECRET_V2, _V3, …
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^JUNO_KEY_SECRET_V(\d+)$/.exec(name);
    if (!match || !value) continue;
    keys.set(Number(match[1]), parseKey(value, name));
  }

  if (keys.size === 0) {
    throw new Error(`${LEGACY_ENV} is not set`);
  }
  return keys;
}

/** The version new secrets are sealed with. Defaults to the highest available. */
export function currentKeyVersion(): number {
  const configured = process.env.JUNO_KEY_VERSION;
  const keys = loadKeys();

  if (configured) {
    const version = Number(configured);
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`JUNO_KEY_VERSION must be a positive integer: ${configured}`);
    }
    if (!keys.has(version)) {
      // Sealing with a key we can't load would write data nobody can ever read.
      throw new Error(
        `JUNO_KEY_VERSION=${version} but no such key is configured — refusing to encrypt with a key that cannot be loaded`,
      );
    }
    return version;
  }
  return Math.max(...keys.keys());
}

export function keyForVersion(version: number): Buffer {
  const key = loadKeys().get(version);
  if (!key) {
    throw new Error(
      `No encryption key configured for version ${version} — the keys sealed with it cannot be opened. Restore that secret before proceeding.`,
    );
  }
  return key;
}

/** Seal a secret key with the CURRENT key version, and record which one. */
export function encryptSecretKey(sk: Uint8Array, version = currentKeyVersion()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyForVersion(version), iv);
  const skB64 = Buffer.from(sk).toString("base64");
  const encrypted = Buffer.concat([cipher.update(skB64, "utf8"), cipher.final()]);
  return {
    encryptedPrivateKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: version,
  };
}

/**
 * Open a sealed key using the version the row was written with.
 *
 * `keyVersion` defaults to 1, so a record written without one opens with the
 * original secret.
 */
export function decryptSecretKey({
  encryptedPrivateKey,
  iv,
  authTag,
  keyVersion = 1,
}: {
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
  keyVersion?: number;
}): Uint8Array {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyForVersion(keyVersion),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const skB64 = Buffer.concat([
    decipher.update(Buffer.from(encryptedPrivateKey, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const sk = new Uint8Array(Buffer.from(skB64, "base64"));
  // A secp256k1 private key is 32 bytes. Anything else is not one of ours.
  if (sk.length !== 32) throw new Error("Decrypted key is malformed");
  return sk;
}
