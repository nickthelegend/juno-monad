import "server-only";

import { bytesToHex, hexToBytes, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { decryptSecretKey, encryptSecretKey } from "@/lib/sealed-keys";
import { networkKey } from "./network";
import { db } from "./social";

/**
 * Juno's own testnet faucet key: created by the server, sealed at rest, and
 * never seen by a person.
 *
 * Monad's public faucet asks for a captcha and a wallet connection, and a
 * visitor with zero MON can do nothing in Juno — not buy, not launch. So the
 * server holds a key of its own and tops wallets up from it. It is generated
 * here the first time it is needed and stored in Mongo sealed with AES-GCM
 * (`JUNO_KEY_SECRET`, see `lib/sealed-keys.ts`), which means no one has to
 * paste a private key into a dashboard to make the faucet work: fund its
 * address and it runs.
 *
 * One key per network, keyed by document id so two instances racing to create
 * it cannot end up with two.
 */
type FaucetDoc = {
  _id: string;
  address: string;
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  createdAt: Date;
};

let cached: PrivateKeyAccount | null = null;

export async function faucetAccount(): Promise<PrivateKeyAccount> {
  if (cached) return cached;
  const collection = (await db()).collection<FaucetDoc>("system");
  const id = `faucet:${networkKey()}`;

  let doc = await collection.findOne({ _id: id });
  if (!doc) {
    const fresh = generatePrivateKey();
    const sealed = encryptSecretKey(hexToBytes(fresh));
    try {
      await collection.insertOne({
        _id: id,
        address: privateKeyToAccount(fresh).address,
        ...sealed,
        createdAt: new Date(),
      });
    } catch {
      // Another instance won the race; use theirs.
    }
    doc = await collection.findOne({ _id: id });
    if (!doc) throw new Error("The faucet key could not be stored");
  }

  const account = privateKeyToAccount(bytesToHex(decryptSecretKey(doc)) as Hex);
  if (account.address !== doc.address) {
    throw new Error("The faucet key does not match its recorded address");
  }
  cached = account;
  return account;
}
