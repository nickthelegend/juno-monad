import "server-only";

import { getAddress, parseEventLogs, type Address, type TransactionReceipt } from "viem";

import { kuruOrderBookAbi } from "./abi";
import { kuruTokenOf } from "./kuru";
import { networkKey } from "./network";
import { db } from "./social";

/**
 * The Kuru orders placed through Juno, remembered from their receipts.
 *
 * With Envio, the indexer names a wallet's orders. Without it (a deployment
 * that runs none, or one that is down), the orders list said "unknown" and
 * the person could neither see nor cancel what they had resting. Juno
 * already records trades from receipts as they land; orders get the same:
 * every `OrderCreated` in a transaction Juno submitted, for its sender, is
 * kept here. The open list is then read from the book itself, as with the
 * indexer, so a filled or cancelled order drops out on its own.
 */

type OrderDoc = { network: string; market: Address; token: Address; owner: Address; orderId: number; tx: string; placedAt: Date };

async function orders() {
  const collection = (await db()).collection<OrderDoc>("kuru_orders");
  await collection.createIndex({ network: 1, market: 1, orderId: 1 }, { unique: true }).catch(() => undefined);
  await collection.createIndex({ network: 1, owner: 1, token: 1, orderId: -1 }).catch(() => undefined);
  return collection;
}

/** Keep the orders this receipt created for its sender on Juno's Kuru markets. Returns how many. */
export async function rememberKuruOrders(receipt: TransactionReceipt, from: Address): Promise<number> {
  const docs: OrderDoc[] = [];
  for (const log of receipt.logs) {
    const market = getAddress(log.address);
    const token = kuruTokenOf(market);
    if (!token) continue;
    for (const event of parseEventLogs({ abi: kuruOrderBookAbi, eventName: "OrderCreated", logs: [log] })) {
      if (getAddress(event.args.owner) !== getAddress(from)) continue;
      docs.push({
        network: networkKey(),
        market,
        token,
        owner: getAddress(from),
        orderId: Number(event.args.orderId),
        tx: receipt.transactionHash,
        placedAt: new Date(),
      });
    }
  }
  if (docs.length === 0) return 0;
  const collection = await orders();
  await collection.bulkWrite(
    docs.map((doc) => ({
      updateOne: { filter: { network: doc.network, market: doc.market, orderId: doc.orderId }, update: { $setOnInsert: doc }, upsert: true },
    })),
  );
  return docs.length;
}

/** The ids of a wallet's recorded orders on a coin's market, newest first: candidates, checked against the book by the caller. */
export async function recordedKuruOrderIds(owner: string, token: string, limit = 100): Promise<bigint[]> {
  const rows = await (await orders())
    .find({ network: networkKey(), owner: getAddress(owner), token: getAddress(token) }, { projection: { orderId: 1 } })
    .sort({ orderId: -1 })
    .limit(limit)
    .toArray();
  return rows.map((row) => BigInt(row.orderId));
}
