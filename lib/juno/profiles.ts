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

  const wallet = await signedBy(input.wallet, nameMessage(input.wallet, name, input.issuedAt), input);

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

/**
 * Check that `wallet` signed `message`, recently. Returns the checksummed
 * address.
 *
 * The message names the wallet as the app sent it. Verifying against the
 * checksummed form would reject a lowercase address the phone signed in good
 * faith, so the caller rebuilds the text from exactly what was submitted, and
 * the signer is checked against the normalised address.
 */
async function signedBy(
  walletInput: string,
  message: string,
  input: { issuedAt: string; signature: string },
): Promise<string> {
  if (!isAddress(walletInput)) throw new CallerError("wallet is not an address");
  const wallet = getAddress(walletInput);

  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > MAX_AGE_MS) {
    throw new CallerError("That request has expired. Try again.");
  }

  if (!isHex(input.signature)) throw new CallerError("The signature is not valid.");
  const verified = await verifyMessage({ address: wallet, message, signature: input.signature }).catch(() => false);
  if (!verified) throw new CallerError("The signature does not match this wallet.");
  return wallet;
}

/* ------------------------------------------------------------------ */
/* Bio and link                                                        */
/* ------------------------------------------------------------------ */

/**
 * What a creator says about themselves: a short bio and one link, the two
 * lines under a name on any profile people already know how to read.
 *
 * Set the way a name is, by a signature from the wallet itself, so nobody can
 * put words in someone else's mouth or point their profile somewhere else.
 * Kept apart from names because a name is unique per network and indexed as
 * such; a profile without a name must not collide with every other one.
 */
type DetailsDoc = { wallet: string; network: string; bio: string; link: string; updatedAt: Date };

export const BIO_MAX = 150;
export const LINK_MAX = 120;

async function details() {
  const collection = (await db()).collection<DetailsDoc>("profile_details");
  await collection.createIndex({ network: 1, wallet: 1 }, { unique: true }).catch(() => undefined);
  return collection;
}

/**
 * The exact text a wallet signs to set its bio and link. Shared with the app.
 * Both values are JSON-quoted so a bio with a line break, or one that contains
 * "Link:", cannot be read as a different pair.
 */
export function detailsMessage(wallet: string, bio: string, link: string, issuedAt: string): string {
  return `Juno profile\nWallet: ${wallet}\nBio: ${JSON.stringify(bio)}\nLink: ${JSON.stringify(link)}\nIssued: ${issuedAt}`;
}

/**
 * A bio as it is kept: trimmed, three or more line breaks in a row collapsed
 * to two, no control characters, at most `BIO_MAX` characters.
 */
export function cleanBio(raw: string): string {
  const bio = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: refusing control characters is the point
  if (/[\u0000-\u0009\u000B-\u001F\u007F]/.test(bio)) throw new CallerError("A bio cannot contain control characters.");
  if ([...bio].length > BIO_MAX) throw new CallerError(`A bio is at most ${BIO_MAX} characters.`);
  return bio;
}

/**
 * A link as it is kept: empty, or an https address with a host and no
 * credentials. Anything else is refused rather than repaired: a profile link
 * is something other people tap.
 */
export function cleanLink(raw: string): string {
  const link = raw.trim();
  if (link === "") return "";
  if (link.length > LINK_MAX) throw new CallerError(`A link is at most ${LINK_MAX} characters.`);
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new CallerError("A link must be a full https:// address.");
  }
  if (url.protocol !== "https:") throw new CallerError("A link must be a full https:// address.");
  if (!url.hostname.includes(".") || url.username || url.password) {
    throw new CallerError("That link is not one people can open.");
  }
  return link;
}

export async function saveDetails(input: {
  wallet: string;
  bio: string;
  link: string;
  issuedAt: string;
  signature: string;
}): Promise<{ wallet: string; bio: string; link: string }> {
  const bio = cleanBio(input.bio);
  const link = cleanLink(input.link);
  // Signed over the values exactly as the app sent them: a bio the server
  // trimmed is still the bio its owner meant.
  const wallet = await signedBy(input.wallet, detailsMessage(input.wallet, input.bio, input.link, input.issuedAt), input);
  await (await details()).updateOne(
    { network: networkKey(), wallet },
    { $set: { bio, link, updatedAt: new Date() } },
    { upsert: true },
  );
  return { wallet, bio, link };
}

/** A wallet's name, bio and link. Null where none was set. */
export async function profileOf(
  walletInput: string,
): Promise<{ wallet: string; name: string | null; bio: string | null; link: string | null }> {
  if (!isAddress(walletInput)) throw new CallerError("wallet is not an address");
  const wallet = getAddress(walletInput);
  const [names, row] = await Promise.all([
    namesFor([wallet]),
    (await details()).findOne({ network: networkKey(), wallet }),
  ]);
  return {
    wallet,
    name: names[wallet] ?? null,
    bio: row?.bio ? row.bio : null,
    link: row?.link ? row.link : null,
  };
}
