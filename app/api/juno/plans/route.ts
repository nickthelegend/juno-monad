import { and, eq } from "drizzle-orm";
import { TransactionReceiptNotFoundError, getAddress, parseEventLogs, type Hex } from "viem";

import { getDb } from "@/lib/db";
import { junoPlans } from "@/lib/db/schema";
import {
  CallerError,
  junoError,
  junoHandler,
  junoJson,
  junoOptions,
  readJson,
  requireNumber,
  requireString,
} from "@/lib/juno/api";
import { junoLaunchpadAbi } from "@/lib/juno/abi";
import { hydratePools } from "@/lib/juno/chain";
import { publicClient } from "@/lib/juno/client";
import { launchpadAddress, networkKey } from "@/lib/juno/network";
import { getPool, listPools } from "@/lib/juno/registry";
import {
  assertAddress,
  createPlan,
  deletePlan,
  plans,
  recordContribution,
  setPlanActive,
} from "@/lib/juno/social-graph";
import { LAUNCHPAD_MISSING, requireTxHash } from "../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * Recurring buys.
 *
 * Deliberately not a bot. Executing a swap on someone's behalf needs a delegate
 * or a session key with spending authority, which this project does not have —
 * so a plan stores the intent and says when it is due, and the buy is the same
 * server-built, device-signed transaction as any other. `contributed` only
 * moves when a buy confirms, and the transaction is checked on the way in, so
 * the progress bar records transactions rather than intentions.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const raw = new URL(request.url).searchParams.get("wallet") ?? "";
    if (!raw) return junoError("A wallet is required");
    const wallet = assertAddress(raw);

    const rows = await plans(wallet);
    if (rows.length === 0) return junoJson({ wallet, plans: [], missing: 0 });

    const registry = await listPools(60);
    const wanted = new Set(rows.map((row) => row.token));
    const { coins, missing } = await hydratePools(registry.filter((r) => wanted.has(r.token)));
    const priced = new Map(coins.map((coin) => [coin.address, coin]));

    return junoJson({
      wallet,
      missing,
      plans: rows.map((row) => {
        const coin = priced.get(row.token) ?? null;
        // No `positionValue` here on purpose. A plan records what was
        // *contributed* in quote terms, not how many tokens each fill bought,
        // so the current worth of what it accumulated is not derivable from
        // this table — the portfolio endpoint owns that question and reads it
        // from the wallet's actual balance.
        return {
          ...row,
          coin: coin
            ? {
                address: coin.address,
                name: coin.name,
                symbol: coin.symbol,
                priceUsd: coin.priceUsd,
                currency: coin.marketCapCurrency,
                // `amount`, `target` and `contributed` are quote-token units —
                // they are what gets signed for. The client needs this symbol
                // to say "5 MON" rather than "$5.00", which is a different
                // number entirely.
                quoteSymbol: coin.quote.symbol,
                quoteUsdRate: coin.quoteUsdRate ?? null,
                media: coin.media,
              }
            : null,
        };
      }),
    });
  });
}

/** `POST {wallet, token, amount, cadence, target?}`. */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const wallet = requireString(body.wallet, "wallet");
    const token = assertAddress(requireString(body.token, "token"), "token");
    const amount = requireNumber(body.amount, "amount");
    const cadence = requireString(body.cadence, "cadence");

    if (cadence !== "daily" && cadence !== "weekly" && cadence !== "monthly") {
      return junoError(`Unknown cadence "${cadence}". One of: daily, weekly, monthly`);
    }
    const row = await getPool(token);
    if (!row) return junoError("Coin not found", 404);

    const id = await createPlan({
      wallet,
      token,
      amount,
      cadence,
      target: body.target === undefined || body.target === null
        ? null
        : requireNumber(body.target, "target"),
    });

    return junoJson({ id }, { status: 201 });
  });
}

/**
 * `PATCH {id, active}` to pause or resume, or `{id, contributed, txHash}` to
 * record a confirmed buy. `DELETE ?id=` removes it.
 */
export async function PATCH(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const id = requireString(body.id, "id");

    if (body.contributed !== undefined) {
      const amount = requireNumber(body.contributed, "contributed");
      if (amount <= 0) return junoError("A contribution must be greater than zero");
      await verifyFill(id, requireTxHash(body.txHash, "txHash"));
      const row = await recordContribution(id, amount);
      if (!row) return junoError("Plan not found", 404);
      return junoJson({ plan: row });
    }

    if (typeof body.active === "boolean") {
      await setPlanActive(id, body.active);
      return junoJson({ id, active: body.active });
    }

    return junoError("Nothing to change: send `active`, or `contributed` with its `txHash`");
  });
}

export async function DELETE(request: Request) {
  return junoHandler(async () => {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id) return junoError("An id is required");
    await deletePlan(id);
    return junoJson({ id, deleted: true });
  });
}

/**
 * Check the fill a client says it made against the chain.
 *
 * The transaction must have succeeded and carry the launchpad's own `Trade`
 * event: a buy, of this plan's coin, by this plan's wallet. That is what lets
 * the progress bar claim to be a record of transactions. It does not stop the
 * same confirmed buy being reported twice — the plan table keeps totals, not a
 * ledger — but it does stop a contribution that never happened.
 */
async function verifyFill(id: string, hash: Hex): Promise<void> {
  const [plan] = await getDb()
    .select({ wallet: junoPlans.wallet, token: junoPlans.token })
    .from(junoPlans)
    .where(and(eq(junoPlans.id, id), eq(junoPlans.network, networkKey())))
    .limit(1);
  if (!plan) throw new CallerError("Plan not found", 404);

  const launchpad = launchpadAddress();
  if (!launchpad) throw new CallerError(LAUNCHPAD_MISSING, 503);

  const receipt = await publicClient()
    .getTransactionReceipt({ hash })
    .catch((error: unknown) => {
      if (error instanceof TransactionReceiptNotFoundError) {
        throw new CallerError("That transaction has no receipt on this network — has it confirmed?", 404);
      }
      throw error;
    });
  if (receipt.status !== "success") {
    throw new CallerError("That transaction reverted, so it bought nothing");
  }

  const bought = parseEventLogs({
    abi: junoLaunchpadAbi,
    eventName: "Trade",
    logs: receipt.logs.filter((log) => getAddress(log.address) === launchpad),
  }).some(
    (event) =>
      event.args.isBuy &&
      getAddress(event.args.token) === getAddress(plan.token) &&
      getAddress(event.args.trader) === getAddress(plan.wallet),
  );
  if (!bought) {
    throw new CallerError("That transaction is not a buy of this plan's coin by its wallet");
  }
}
