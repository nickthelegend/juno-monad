import "server-only";

import { randomUUID } from "node:crypto";
import { getAddress, isAddress, isHex, sha256, stringToBytes, verifyMessage } from "viem";

import { CallerError } from "./api";
import { networkKey } from "./network";
import { db } from "./social";

/**
 * Sealed drafts: a post's words, encrypted to the creator's passkey.
 *
 * The app seals a draft with Mera's secret vault — AES-256-GCM under a key
 * from the passkey's WebAuthn PRF output, each draft with its own random PRF
 * salt, so a namespace separate from the one that derives the wallet. This
 * server keeps only the vault: ciphertext, nonce, salt and which passkey
 * opens it. It cannot read a draft, and neither can anyone else; the same
 * passkey opens it on any device.
 *
 * Writes are signed by the wallet (EIP-191), so nobody can fill someone
 * else's drafts or delete them; with a Mera signing session open that
 * signature asks for nothing.
 */

type DraftDoc = { id: string; network: string; wallet: string; vault: string; createdAt: Date };

const MAX_DRAFTS = 20;
const MAX_AGE_MS = 5 * 60_000;
const B64URL = /^[A-Za-z0-9_-]+$/;

async function drafts() {
  const collection = (await db()).collection<DraftDoc>("drafts");
  await collection.createIndex({ network: 1, wallet: 1, createdAt: -1 }).catch(() => undefined);
  return collection;
}

/** The text a wallet signs to store a sealed draft. Shared with the app. */
export function sealDraftMessage(wallet: string, vaultJson: string, issuedAt: string): string {
  return `Juno sealed draft\nWallet: ${wallet}\nVault: ${sha256(stringToBytes(vaultJson))}\nIssued: ${issuedAt}`;
}

/** The text a wallet signs to delete one. Shared with the app. */
export function deleteDraftMessage(wallet: string, id: string, issuedAt: string): string {
  return `Juno delete sealed draft\nWallet: ${wallet}\nDraft: ${id}\nIssued: ${issuedAt}`;
}

/**
 * A Mera secret vault, checked for shape and size without being able to open
 * it: version 1, a credential id, a 32-byte salt, a 12-byte nonce, a bounded
 * ciphertext — all base64url.
 */
function checkVault(vaultJson: string): void {
  if (vaultJson.length > 16_000) throw new CallerError("That draft is too long to seal.");
  let vault: Record<string, unknown>;
  try {
    vault = JSON.parse(vaultJson);
  } catch {
    throw new CallerError("vault is not JSON");
  }
  const credential = vault.credential as { credentialId?: unknown } | undefined;
  const ok =
    vault.version === 1 &&
    typeof credential?.credentialId === "string" &&
    B64URL.test(credential.credentialId) &&
    credential.credentialId.length <= 512 &&
    typeof vault.prfSalt === "string" &&
    B64URL.test(vault.prfSalt) &&
    vault.prfSalt.length === 43 &&
    typeof vault.nonce === "string" &&
    B64URL.test(vault.nonce) &&
    vault.nonce.length === 16 &&
    typeof vault.ciphertext === "string" &&
    B64URL.test(vault.ciphertext) &&
    vault.ciphertext.length >= 22;
  if (!ok) throw new CallerError("vault is not a Mera secret vault");
}

async function checkSigned(wallet: string, message: string, issuedAt: string, signature: string): Promise<void> {
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > MAX_AGE_MS) {
    throw new CallerError("That request has expired. Try again.");
  }
  if (!isHex(signature)) throw new CallerError("The signature is not valid.");
  const verified = await verifyMessage({ address: getAddress(wallet), message, signature }).catch(() => false);
  if (!verified) throw new CallerError("The signature does not match this wallet.");
}

function requireWallet(wallet: string): string {
  if (!isAddress(wallet)) throw new CallerError("wallet is not an address");
  return getAddress(wallet);
}

/** A wallet's sealed drafts, newest first — opaque vaults only. */
export async function listDrafts(walletInput: string): Promise<Array<{ id: string; createdAt: string; vault: string }>> {
  const wallet = requireWallet(walletInput);
  const rows = await (await drafts())
    .find({ network: networkKey(), wallet }, { projection: { _id: 0, id: 1, createdAt: 1, vault: 1 } })
    .sort({ createdAt: -1 })
    .limit(MAX_DRAFTS)
    .toArray();
  return rows.map((row) => ({ id: row.id, createdAt: row.createdAt.toISOString(), vault: row.vault }));
}

export async function saveDraft(input: { wallet: string; vault: string; issuedAt: string; signature: string }) {
  const wallet = requireWallet(input.wallet);
  checkVault(input.vault);
  await checkSigned(wallet, sealDraftMessage(input.wallet, input.vault, input.issuedAt), input.issuedAt, input.signature);
  const collection = await drafts();
  if ((await collection.countDocuments({ network: networkKey(), wallet })) >= MAX_DRAFTS) {
    throw new CallerError(`You have ${MAX_DRAFTS} sealed drafts. Delete one first.`);
  }
  const doc: DraftDoc = { id: randomUUID().replace(/-/g, ""), network: networkKey(), wallet, vault: input.vault, createdAt: new Date() };
  await collection.insertOne(doc);
  return { id: doc.id, createdAt: doc.createdAt.toISOString() };
}

export async function deleteDraft(input: { wallet: string; id: string; issuedAt: string; signature: string }) {
  const wallet = requireWallet(input.wallet);
  if (!/^[0-9a-f]{32}$/.test(input.id)) throw new CallerError("id is not a draft id");
  await checkSigned(wallet, deleteDraftMessage(input.wallet, input.id, input.issuedAt), input.issuedAt, input.signature);
  const { deletedCount } = await (await drafts()).deleteOne({ network: networkKey(), wallet, id: input.id });
  if (!deletedCount) throw new CallerError("No such draft");
  return { deleted: input.id };
}
