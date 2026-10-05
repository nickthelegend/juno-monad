import "server-only";

import { PrivyClient } from "@privy-io/node";
import { getAddress, isAddress } from "viem";

import { CallerError } from "./api";
import { networkKey } from "./network";
import { db } from "./social";

/**
 * Who a wallet belongs to, as Privy knows them.
 *
 * Someone who signs in to Juno with Privy gets an embedded wallet, and may
 * have linked an X account to the same Privy login. Privy has verified that X
 * account through OAuth, so Juno can say "this creator is @handle" with more
 * than the creator's word for it — on a feed where the post *is* a market,
 * knowing whose post you are buying into is the first question.
 *
 * The check runs on the server with the app secret: the app sends the
 * session's access token, the server verifies it, reads the Privy user, and
 * only records an identity for a wallet that is one of that user's own. Only
 * the X handle is published. An email or Google address proves the account
 * is a person's, and is kept as a yes/no — never shown, never stored.
 */

export type WalletIdentity = {
  /** X handle, verified by Privy's OAuth. */
  twitter?: string;
  /** Signed in with an email or Google account Privy verified. */
  emailVerified: boolean;
  via: "privy";
  verifiedAt: string;
};

type IdentityDoc = {
  network: string;
  wallet: string;
  privyUserId: string;
  twitter: string | null;
  emailVerified: boolean;
  verifiedAt: Date;
};

export function privyConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() && process.env.PRIVY_APP_SECRET?.trim());
}

let client: PrivyClient | null = null;

/** The server's Privy client (app id and secret). Throws a 503 when Privy is not configured. */
export function privy(): PrivyClient {
  if (!privyConfigured()) throw new CallerError("Privy is not configured on this server", 503);
  client ??= new PrivyClient({
    appId: process.env.NEXT_PUBLIC_PRIVY_APP_ID!.trim(),
    appSecret: process.env.PRIVY_APP_SECRET!.trim(),
  });
  return client;
}

async function identities() {
  const collection = (await db()).collection<IdentityDoc>("identities");
  await collection.createIndex({ network: 1, wallet: 1 }, { unique: true }).catch(() => undefined);
  return collection;
}

/**
 * Verify a Privy session and record the identity of one of its wallets.
 *
 * Refuses a wallet the Privy user does not own — the embedded wallet or a
 * wallet they linked — so nobody can pin their X handle to someone else's
 * address.
 */
export async function verifyPrivyIdentity(input: { accessToken: string; wallet: string }): Promise<WalletIdentity> {
  if (!isAddress(input.wallet)) throw new CallerError("wallet is not an address");
  const wallet = getAddress(input.wallet);

  let userId: string;
  try {
    ({ user_id: userId } = await privy().utils().auth().verifyAccessToken(input.accessToken));
  } catch {
    throw new CallerError("That Privy session is not valid. Sign in again.", 401);
  }

  const user = await privy().users()._get(userId);
  const owned = user.linked_accounts
    .filter((account) => account.type === "wallet" && "chain_type" in account && account.chain_type === "ethereum")
    .map((account) => ("address" in account && isAddress(account.address) ? getAddress(account.address) : null));
  if (!owned.includes(wallet)) {
    throw new CallerError("That wallet is not one of this Privy account's wallets", 403);
  }

  const twitter = user.linked_accounts.find((account) => account.type === "twitter_oauth");
  const handle = twitter && "username" in twitter && twitter.username ? twitter.username : null;
  const emailVerified = user.linked_accounts.some(
    (account) => account.type === "email" || account.type === "google_oauth",
  );

  const verifiedAt = new Date();
  await (await identities()).updateOne(
    { network: networkKey(), wallet },
    { $set: { privyUserId: userId, twitter: handle, emailVerified, verifiedAt } },
    { upsert: true },
  );
  return { twitter: handle ?? undefined, emailVerified, via: "privy", verifiedAt: verifiedAt.toISOString() };
}

/** Verified identities for up to a page of wallets, keyed by checksummed address. */
export async function identitiesFor(wallets: string[]): Promise<Record<string, WalletIdentity>> {
  if (wallets.length === 0) return {};
  const rows = await (await identities())
    .find({ network: networkKey(), wallet: { $in: wallets } })
    .toArray();
  return Object.fromEntries(
    rows.map((row) => [
      row.wallet,
      {
        twitter: row.twitter ?? undefined,
        emailVerified: row.emailVerified,
        via: "privy" as const,
        verifiedAt: row.verifiedAt.toISOString(),
      },
    ]),
  );
}
