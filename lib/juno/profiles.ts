import "server-only";

import { getAddress, isAddress, isHex, verifyMessage } from "viem";

import { CallerError } from "./api";
import { networkKey } from "./network";
import { db } from "./social";

/**
 * Names for wallets.
 *
 * A social app where every person is "0x3bd3…433A" is a ledger with pictures.
 * A name is chosen once, proven by the wallet that owns it, and shown
 * wherever an address used to be. The address stays one tap away — on a
 * market, who someone is on-chain is the fact; the name is how you recognise
 * them.
 *
 * A name is claimed by signing a short message with the wallet's key — an
 * ordinary EIP-191 `personal_sign`, the same thing any Ethereum wallet shows as
 * "Sign message" — so no one can rename someone else and there is no password
 * to lose. Names are unique case-insensitively per network.
 */
type ProfileDoc = { wallet: string; network: string; name: string; nameKey: string; updatedAt: Date };

const NAME = /^[a-z0-9_]{3,20}$/;
const RESERVED = new Set(["juno", "admin", "support", "official", "monad", "tessera", "pyth", "uniswap"]);
/** How old a signed request may be. Long enough for a slow phone, short enough not to replay. */
const MAX_AGE_MS = 5 * 60_000;

async function profiles() {
  const collection = (await db()).collection<ProfileDoc>("profiles");
  await Promise.all([
    collection.createIndex({ network: 1, wallet: 1 }, { unique: true }),
    collection.createIndex({ network: 1, nameKey: 1 }, { unique: true }),
  ]).catch(() => undefined);
  return collection;
}

/** The exact text a wallet signs to claim a name. Shared with the app. */
export function nameMessage(wallet: string, name: string, issuedAt: string): string {
  return `Juno name: ${name}\nWallet: ${wallet}\nIssued: ${issuedAt}`;
}

export async function namesFor(wallets: string[]): Promise<Record<string, string>> {
  if (wallets.length === 0) return {};
  const rows = await (await profiles())
    .find({ network: networkKey(), wallet: { $in: wallets } }, { projection: { wallet: 1, name: 1 } })
    .toArray();
  return Object.fromEntries(rows.map((row) => [row.wallet, row.name]));
}

export async function claimName(input: {
  wallet: string;
  name: string;
  issuedAt: string;
  signature: string;
}): Promise<{ wallet: string; name: string }> {
  const name = input.name.trim();
  const key = name.toLowerCase();
  if (!NAME.test(key)) {
    throw new CallerError("Names are 3–20 characters: letters, digits and underscores.");
  }
  if (RESERVED.has(key)) throw new CallerError("That name is reserved.");

  if (!isAddress(input.wallet)) throw new CallerError("wallet is not an address");
  const wallet = getAddress(input.wallet);

  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > MAX_AGE_MS) {
    throw new CallerError("That request has expired. Try again.");
  }

  if (!isHex(input.signature)) throw new CallerError("The signature is not valid.");
  /*
   * The message names the wallet as the app sent it. Verifying against the
   * checksummed form would reject a lowercase address the phone signed in good
   * faith, so the text is rebuilt from exactly what was submitted, and the
   * signer is checked against the normalised address.
   */
  const verified = await verifyMessage({
    address: wallet,
    message: nameMessage(input.wallet, name, input.issuedAt),
    signature: input.signature,
  }).catch(() => false);
  if (!verified) throw new CallerError("The signature does not match this wallet.");

  const collection = await profiles();
  try {
    await collection.updateOne(
      { network: networkKey(), wallet },
      { $set: { name, nameKey: key, updatedAt: new Date() } },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new CallerError("That name is taken.");
    throw error;
  }
  return { wallet, name };
}
