import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, isHex, verifyMessage } from "viem";

import { currentKeyVersion, keyForVersion } from "@/lib/sealed-keys";
import { CallerError } from "./api";
import { publicClient } from "./client";
import { localFork, networkKey } from "./network";
import {
  bytesOf,
  checkClientData,
  derToRS,
  P256_PRECOMPILE,
  p256Input,
  passkeyLinkMessage,
  precompileSaysValid,
  webauthnDigest,
} from "./passkey-verify";
import { db } from "./social";

/**
 * Linking a wallet to its passkey, proved on Monad.
 *
 * 1. The server issues a challenge for the wallet: random bytes and a time,
 *    with an HMAC so it needs no storage, valid for five minutes.
 * 2. The passkey signs it (a WebAuthn assertion); the wallet signs a message
 *    naming the passkey's public key and the challenge.
 * 3. The server checks the assertion with Monad's P256 precompile (eth_call
 *    to 0x…0100 on the chain this deployment uses) and the wallet's signature,
 *    then records the link. A profile with one says "passkey, verified on
 *    Monad".
 */
const TTL_MS = 5 * 60_000;

function challengeKey(): Buffer {
  return createHmac("sha256", keyForVersion(currentKeyVersion())).update("juno passkey challenge v1").digest();
}

/** 8 bytes of time, 16 random, 16 of HMAC over both and the wallet: 40 bytes, hex. */
export function issueChallenge(walletInput: string, now = Date.now()): { challenge: string; expiresAt: string } {
  if (!isAddress(walletInput)) throw new CallerError("wallet is not an address");
  const wallet = getAddress(walletInput);
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(now));
  const nonce = randomBytes(16);
  const mac = createHmac("sha256", challengeKey()).update(Buffer.concat([time, nonce, Buffer.from(wallet)])).digest().subarray(0, 16);
  return { challenge: `0x${Buffer.concat([time, nonce, mac]).toString("hex")}`, expiresAt: new Date(now + TTL_MS).toISOString() };
}

function openChallenge(wallet: string, challengeHex: string, now: number): Uint8Array {
  if (!isHex(challengeHex) || challengeHex.length !== 2 + 80) throw new CallerError("That challenge is not one Juno issued.");
  const bytes = Buffer.from(challengeHex.slice(2), "hex");
  const [time, nonce, mac] = [bytes.subarray(0, 8), bytes.subarray(8, 24), bytes.subarray(24)];
  const expected = createHmac("sha256", challengeKey()).update(Buffer.concat([time, nonce, Buffer.from(wallet)])).digest().subarray(0, 16);
  if (!timingSafeEqual(mac, expected)) throw new CallerError("That challenge is not one Juno issued for this wallet.");
  if (now - Number(time.readBigUInt64BE()) > TTL_MS) throw new CallerError("That challenge has expired. Try again.");
  return new Uint8Array(bytes);
}

type LinkDoc = { network: string; wallet: string; keyHash: string; credentialId: string; verifiedAt: Date; where: "monad" | "local fork" };

async function links() {
  const collection = (await db()).collection<LinkDoc>("passkey_links");
  await collection.createIndex({ network: 1, wallet: 1 }, { unique: true }).catch(() => undefined);
  return collection;
}

export async function verifyPasskeyLink(
  input: {
    wallet: string;
    challenge: string;
    credentialId: string;
    publicKey: { x: string; y: string };
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
    walletSignature: string;
  },
  now = Date.now(),
): Promise<{ wallet: string; verifiedAt: string; where: "monad" | "local fork" }> {
  if (!isAddress(input.wallet)) throw new CallerError("wallet is not an address");
  const wallet = getAddress(input.wallet);
  const challenge = openChallenge(wallet, input.challenge, now);

  let x: Uint8Array, y: Uint8Array, authenticatorData: Uint8Array, clientDataJSON: Uint8Array, der: Uint8Array;
  try {
    x = bytesOf(input.publicKey.x);
    y = bytesOf(input.publicKey.y);
    authenticatorData = bytesOf(input.authenticatorData);
    clientDataJSON = bytesOf(input.clientDataJSON);
    der = bytesOf(input.signature);
  } catch {
    throw new CallerError("The passkey assertion is not well formed.");
  }
  try {
    checkClientData(clientDataJSON, challenge);
  } catch (error) {
    throw new CallerError((error as Error).message);
  }
  let rs: { r: Uint8Array; s: Uint8Array };
  try {
    rs = derToRS(der);
  } catch {
    throw new CallerError("The passkey signature is not a P-256 signature.");
  }

  // Monad's own code decides: the P256 precompile, called as a contract would.
  const data = p256Input(webauthnDigest(authenticatorData, clientDataJSON), rs.r, rs.s, x, y);
  const answer = await publicClient()
    .call({ to: P256_PRECOMPILE, data })
    .then((result) => result.data ?? null)
    .catch(() => null);
  if (!precompileSaysValid(answer)) throw new CallerError("Monad's P256 precompile did not accept this passkey signature.");

  // And the wallet says the passkey is its own.
  const keyHex = `0x${Buffer.from(x).toString("hex")}${Buffer.from(y).toString("hex")}`;
  const signedByWallet = await verifyMessage({
    address: wallet,
    message: passkeyLinkMessage(wallet, keyHex, input.challenge),
    signature: input.walletSignature as `0x${string}`,
  }).catch(() => false);
  if (!signedByWallet) throw new CallerError("The wallet did not sign for this passkey.");

  const where: "monad" | "local fork" = localFork() ? "local fork" : "monad";
  const verifiedAt = new Date(now);
  await (await links()).updateOne(
    { network: networkKey(), wallet },
    {
      $set: {
        keyHash: createHash("sha256").update(Buffer.from(keyHex.slice(2), "hex")).digest("hex"),
        credentialId: input.credentialId,
        verifiedAt,
        where,
      },
    },
    { upsert: true },
  );
  return { wallet, verifiedAt: verifiedAt.toISOString(), where };
}

export async function passkeyLinkOf(walletInput: string): Promise<{ verifiedAt: string; where: "monad" | "local fork" } | null> {
  if (!isAddress(walletInput)) return null;
  const row = await (await links()).findOne({ network: networkKey(), wallet: getAddress(walletInput) }).catch(() => null);
  return row ? { verifiedAt: row.verifiedAt.toISOString(), where: row.where } : null;
}
