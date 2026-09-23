import "server-only";

import {
  BaseError,
  decodeErrorResult,
  getAddress,
  isAddress,
  parseEventLogs,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

import { junoLaunchpadAbi, junoTokenAbi } from "./abi";
import { CallerError } from "./api";
import { publicClient } from "./client";
import { CURVE_PRESETS } from "./curves";
import {
  InsufficientLiquidityError,
  buildApproveCall,
  buildClaimCreatorFeesCall,
  buildGraduateCall,
  buildSwapCall,
  fetchPoolSnapshot,
  invalidatePoolSnapshot,
  planLaunch,
  quoteAllowance,
  quoteTokenFor,
  quoteTrade,
  tradeDeadline,
  uiToWei,
  type ContractCall,
  type TradeQuote,
} from "./launchpad";
import { chainId, launchpadAddress, requireLaunchpad } from "./network";
import { quoteTokenUsdPrice } from "./pyth";
import { withRetry } from "./rpc";
import { invalidateSwapHistory, recordReceiptTrades } from "./swaps";
import type { CurvePresetId, TradeSide } from "./types";

/**
 * Transactions built on the server, signed on the device.
 *
 * The mobile client carries no contract ABIs and no RPC logic. It asks for an
 * unsigned transaction, signs it with the key in its secure store, and hands
 * the signed bytes back to be broadcast. The private key never leaves the phone
 * and the result is an ordinary Monad transaction anyone can check on an
 * explorer — this is a thin-client split, not a custodial one.
 *
 * ## Steps
 *
 * Most actions are one call. A buy quoted in USDC is two the first time — an
 * approval, then the buy — and both are built together with consecutive
 * nonces, so the phone signs twice and the server submits them in order. The
 * buy's gas cannot be estimated until the approval exists, so it carries a
 * fixed ceiling instead; see `FALLBACK_GAS`.
 *
 * ## Gas on Monad
 *
 * Monad charges for the gas *limit*, not the gas used. A generous limit is
 * money thrown away, so every step is estimated against the chain and given a
 * modest margin rather than a round number.
 */

/**
 * Headroom over an estimate — enough for state to move a little before
 * inclusion. Monad's own guidance is about 7.5%, not the 30–50% wallets
 * habitually add, because the whole limit is charged.
 */
const GAS_MARGIN_BPS = 750n;

/**
 * Ceiling for a step that cannot be estimated because it depends on an earlier
 * step in the same batch. A buy walks at most sixteen ranges.
 */
const FALLBACK_GAS = 350_000n;

/**
 * Where a launch starts and where it graduates, **in US dollars**.
 *
 * Market caps are a launch parameter rather than a property of the curve
 * preset — the same shape can be opened at any size. The curve takes them in
 * quote-token units, so they are converted at the quote token's live price
 * when the launch is built.
 */
const DEFAULT_INITIAL_MARKET_CAP_USD = 1_000;
const DEFAULT_MIGRATION_MARKET_CAP_USD = 25_000;

/** The default market caps restated in this quote token's units. */
async function defaultCapsIn(quote: string): Promise<{ initial: number; migration: number }> {
  const usd = await quoteTokenUsdPrice(quote).catch(() => null);
  if (usd === null || !(usd > 0)) {
    throw new CallerError(
      "The quote token's price could not be read, so the launch size cannot be set. Try again in a moment.",
    );
  }
  return {
    initial: DEFAULT_INITIAL_MARKET_CAP_USD / usd,
    migration: DEFAULT_MIGRATION_MARKET_CAP_USD / usd,
  };
}

/**
 * An EIP-1559 transaction, every number hex-encoded so it survives JSON.
 * The phone passes these fields straight to viem's `signTransaction`.
 */
export type UnsignedTransaction = {
  label: string;
  request: {
    type: "eip1559";
    chainId: number;
    from: Address;
    to: Address;
    data: Hex;
    value: Hex;
    nonce: number;
    gas: Hex;
    maxFeePerGas: Hex;
    maxPriorityFeePerGas: Hex;
  };
};

/** When a built trade stops being valid. Past it, the contract refuses it. */
export type TxWindow = {
  /** Unix seconds. */
  deadline: number;
};

/**
 * Turn calls into transactions: one nonce each, gas estimated where it can be,
 * one fee quote for the batch.
 *
 * A failed estimate on the *first* step is the chain saying this would revert,
 * so it is explained and thrown. On a later step it is expected — that step
 * depends on the ones before it — and it gets the fixed ceiling.
 */
async function prepare(from: Address, calls: ContractCall[]): Promise<UnsignedTransaction[]> {
  const client = publicClient();
  const [nonce, fees] = await Promise.all([
    withRetry(() => client.getTransactionCount({ address: from, blockTag: "pending" })),
    withRetry(() => client.estimateFeesPerGas()),
  ]);

  const steps: UnsignedTransaction[] = [];
  for (const [index, call] of calls.entries()) {
    let gas: bigint;
    try {
      const estimate = await withRetry(() =>
        client.estimateGas({ account: from, to: call.to, data: call.data, value: call.value }),
      );
      gas = estimate + (estimate * GAS_MARGIN_BPS) / 10_000n;
    } catch (error) {
      if (index === 0) throw new CallerError(explainFailure(error), 422);
      gas = FALLBACK_GAS;
    }
    steps.push({
      label: call.label,
      request: {
        type: "eip1559",
        chainId: chainId(),
        from,
        to: call.to,
        data: call.data,
        value: toHex(call.value),
        nonce: nonce + index,
        gas: toHex(gas),
        maxFeePerGas: toHex(fees.maxFeePerGas),
        maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas),
      },
    });
  }
  return steps;
}

function requireWallet(value: string, field: string): Address {
  if (!isAddress(value)) throw new CallerError(`${field} is not a Monad address`);
  return getAddress(value);
}

/* ------------------------------------------------------------------ */
/* Swap                                                                */
/* ------------------------------------------------------------------ */

export type SwapBuildRequest = {
  /** The coin being traded. */
  token: string;
  side: TradeSide;
  /** Input amount in UI units — quote units on a buy, token units on a sell. */
  amountIn: number;
  /** The wallet that will sign and pay. */
  owner: string;
  slippageBps?: number;
};

export type SwapBuildResult = {
  /** In order. Usually one; an approval first when a USDC buy needs one. */
  steps: UnsignedTransaction[];
  window: TxWindow;
  quote: Omit<TradeQuote, "raw">;
  /** What the quote is denominated in, for honest labelling on the client. */
  quoteSymbol: string;
  /** Null when no USD feed is available for the quote token. */
  quoteUsdRate: number | null;
};

export async function buildSwap(request: SwapBuildRequest): Promise<SwapBuildResult> {
  if (!Number.isFinite(request.amountIn) || request.amountIn <= 0) {
    throw new CallerError("Amount must be greater than zero");
  }

  const owner = requireWallet(request.owner, "owner");
  const snapshot = await fetchPoolSnapshot(request.token);
  if (!snapshot) throw new CallerError("This coin has no pool on this network");

  // The contract rejects a trade against a finished curve. Saying so here is a
  // far better error than the one the chain would return after signing.
  if (snapshot.curve.graduated) {
    throw new CallerError("This coin has graduated — it trades on its AMM pair now");
  }
  if (snapshot.curve.complete) {
    throw new CallerError("This curve is full. It graduates to its AMM pair next.");
  }

  const quote = await quoteTrade({
    snapshot,
    side: request.side,
    amountIn: request.amountIn,
    slippageBps: request.slippageBps ?? 100,
  }).catch((error: unknown) => {
    if (error instanceof InsufficientLiquidityError) {
      throw new CallerError(
        request.side === "sell"
          ? "There is not enough in this pool to buy that back. Try a smaller amount."
          : "This curve cannot fill that size. Try a smaller amount.",
      );
    }
    throw error;
  });
  if (quote.raw.amountOut === 0n) throw new CallerError("That amount is too small to trade");

  const deadline = tradeDeadline();
  const calls: ContractCall[] = [];
  if (request.side === "buy" && !snapshot.quote.native) {
    const allowance = await quoteAllowance(owner, snapshot.quote, snapshot.launchpad);
    if (allowance < quote.raw.amountIn) calls.push(buildApproveCall(snapshot.quote, snapshot.launchpad));
  }
  calls.push(buildSwapCall({ snapshot, owner, side: request.side, quote, deadline }));

  const steps = await prepare(owner, calls);
  const quoteUsdRate = await quoteTokenUsdPrice(snapshot.quote.address).catch(() => null);
  const { raw: _raw, ...publicQuote } = quote;

  return {
    steps,
    window: { deadline: Number(deadline) },
    quote: publicQuote,
    quoteSymbol: snapshot.quote.symbol,
    quoteUsdRate,
  };
}

/* ------------------------------------------------------------------ */
/* Launch                                                              */
/* ------------------------------------------------------------------ */

export type LaunchBuildRequest = {
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  preset: CurvePresetId;
  /** Quote token address; the zero address is native MON. */
  quote: string;
  initialMarketCap?: number;
  migrationMarketCap?: number;
  /** Optional creator's first buy, in quote units, made in the same transaction. */
  firstBuy?: number;
};

export type LaunchBuildResult = {
  steps: UnsignedTransaction[];
  /** Where the token will be — the launchpad predicted it. */
  token: Address;
  launchpad: Address;
  /** What the curve will raise before graduating, in quote units. */
  migrationQuoteThreshold: number;
};

export async function buildLaunch(request: LaunchBuildRequest): Promise<LaunchBuildResult> {
  const preset = CURVE_PRESETS[request.preset];
  if (!preset) {
    throw new CallerError(
      `Unknown preset "${request.preset}". One of: ${Object.keys(CURVE_PRESETS).join(", ")}`,
    );
  }

  const quote = quoteTokenFor(request.quote);
  if (!quote) throw new CallerError("Unsupported quote token");
  const creator = requireWallet(request.creator, "creator");

  // Explicit caps are taken as given, in quote units — the scripts rely on
  // that. Only the defaults are dollars, converted here.
  const caps =
    request.initialMarketCap === undefined || request.migrationMarketCap === undefined
      ? await defaultCapsIn(quote.address)
      : null;

  let plan;
  try {
    plan = await planLaunch({
      creator,
      quote,
      name: request.name,
      symbol: request.symbol,
      uri: request.uri,
      preset: request.preset,
      initialMarketCap: request.initialMarketCap ?? caps!.initial,
      migrationMarketCap: request.migrationMarketCap ?? caps!.migration,
      firstBuy: request.firstBuy,
    });
  } catch (error) {
    if (error instanceof CallerError) throw error;
    // The curve builder refuses an impossible valuation pair with a sentence.
    if (error instanceof Error && !(error instanceof BaseError)) throw new CallerError(error.message);
    throw error;
  }

  const calls: ContractCall[] = [];
  if (request.firstBuy && request.firstBuy > 0 && !quote.native) {
    const allowance = await quoteAllowance(creator, quote);
    if (allowance < uiToWei(request.firstBuy, quote.decimals)) calls.push(buildApproveCall(quote));
  }
  calls.push(plan.call);

  return {
    steps: await prepare(creator, calls),
    token: plan.token,
    launchpad: requireLaunchpad(),
    migrationQuoteThreshold: Number(plan.params.totals.threshold) / 10 ** quote.decimals,
  };
}

/* ------------------------------------------------------------------ */
/* Creator fees and graduation                                         */
/* ------------------------------------------------------------------ */

export async function buildClaim(request: { creator: string; token: string }): Promise<UnsignedTransaction[]> {
  const creator = requireWallet(request.creator, "creator");
  const snapshot = await fetchPoolSnapshot(request.token);
  if (!snapshot) throw new CallerError("This coin has no pool on this network");
  if (snapshot.pool.creator !== creator) throw new CallerError("Only the creator can claim this coin's fees", 403);
  if (snapshot.pool.creatorFees === 0n) throw new CallerError("Nothing to claim yet");
  return prepare(creator, [
    buildClaimCreatorFeesCall({ token: snapshot.token, to: creator, launchpad: snapshot.launchpad }),
  ]);
}

export async function buildGraduate(request: { from: string; token: string }): Promise<UnsignedTransaction[]> {
  const from = requireWallet(request.from, "from");
  const snapshot = await fetchPoolSnapshot(request.token);
  if (!snapshot) throw new CallerError("This coin has no pool on this network");
  if (snapshot.curve.graduated) throw new CallerError("This coin has already graduated");
  if (!snapshot.curve.complete) throw new CallerError("The curve has not filled yet");
  return prepare(from, [buildGraduateCall({ token: snapshot.token, launchpad: snapshot.launchpad })]);
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

export type SubmitResult = {
  hash: Hex;
  blockNumber: number;
  from: Address;
  /** Trades the transaction made, as recorded. */
  trades: number;
  /** Set when the transaction launched a token. */
  launched?: { token: Address; pair: Address | null; creator: Address };
  /** Set when the transaction graduated a curve. */
  graduated?: { token: Address; venue: Address };
  /** Set when a buy filled the curve to its top. */
  completed?: Address[];
};

/** How long to wait for a receipt. Monad finalises in about a second. */
const RECEIPT_TIMEOUT_MS = 30_000;

/**
 * Broadcast a transaction the device signed, wait for its receipt, and record
 * what it did.
 *
 * The chain id is checked before anything is sent: a transaction signed for
 * the other network would otherwise fail with an error about a nonce or a
 * balance that has nothing to do with the real problem.
 */
export async function submitSigned(params: { signed: Hex }): Promise<SubmitResult> {
  const client = publicClient();

  let parsed;
  let from: Address;
  try {
    parsed = parseTransaction(params.signed);
    from = await recoverTransactionAddress({ serializedTransaction: params.signed as never });
  } catch {
    throw new CallerError("That is not a signed Monad transaction");
  }
  if (parsed.chainId !== undefined && parsed.chainId !== chainId()) {
    throw new CallerError(`This transaction was signed for chain ${parsed.chainId}, not ${chainId()}`);
  }

  let hash: Hex;
  try {
    hash = await client.sendRawTransaction({ serializedTransaction: params.signed });
  } catch (error) {
    // A node refusing *this transaction* is not a fault in this server, and
    // reporting it as one hides the one thing the person can act on.
    throw new CallerError(explainFailure(error), 422);
  }

  let receipt: TransactionReceipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  } catch {
    throw new CallerError(
      `The network accepted this transaction but it has not confirmed yet. It is ${hash}.`,
      504,
    );
  }

  if (receipt.status !== "success") {
    const reason = await revertReason(hash, receipt).catch(() => null);
    throw new CallerError(
      `${reason ?? "The transaction reverted."} It is on-chain as ${hash}.`,
      422,
    );
  }

  return describeReceipt(receipt, from);
}

async function describeReceipt(receipt: TransactionReceipt, from: Address): Promise<SubmitResult> {
  const launchpad = launchpadAddress();
  const result: SubmitResult = {
    hash: receipt.transactionHash,
    blockNumber: Number(receipt.blockNumber),
    from,
    trades: 0,
  };
  if (!launchpad) return result;

  const ours = receipt.logs.filter((log) => getAddress(log.address) === launchpad);
  const events = parseEventLogs({ abi: junoLaunchpadAbi, logs: ours });

  const touched = new Set<string>();
  const completed: Address[] = [];
  for (const event of events) {
    if (event.eventName === "Launched") {
      result.launched = {
        token: getAddress(event.args.token),
        pair: /^0x0+$/.test(event.args.venue) ? null : getAddress(event.args.venue),
        creator: getAddress(event.args.creator),
      };
      touched.add(event.args.token);
    } else if (event.eventName === "Graduated") {
      result.graduated = { token: getAddress(event.args.token), venue: getAddress(event.args.venue) };
      touched.add(event.args.token);
    } else if (event.eventName === "CurveCompleted") {
      completed.push(getAddress(event.args.token));
    } else if (event.eventName === "Trade" || event.eventName === "CreatorFeesClaimed") {
      touched.add(event.args.token);
    }
  }
  if (completed.length) result.completed = completed;

  const trades = await recordReceiptTrades(receipt).catch(() => []);
  result.trades = trades.length;

  // The price, curve and history all just moved. Drop them so the next read
  // is live rather than a few seconds stale.
  for (const token of touched) {
    invalidatePoolSnapshot(token);
    invalidateSwapHistory(token);
  }
  return result;
}

/**
 * Why a mined transaction reverted, re-derived by replaying it as a call at
 * its own block. Receipts carry no reason; the replay does.
 */
async function revertReason(hash: Hex, receipt: TransactionReceipt): Promise<string | null> {
  const client = publicClient();
  const tx = await client.getTransaction({ hash });
  try {
    await client.call({
      account: tx.from,
      to: tx.to ?? undefined,
      data: tx.input,
      value: tx.value,
      blockNumber: receipt.blockNumber,
    });
    return null;
  } catch (error) {
    return explainFailure(error);
  }
}

/**
 * A transaction the network would not take, said in a sentence.
 *
 * The launchpad reverts with named errors, so most failures decode to exactly
 * what happened. What someone trying to buy $2 of a coin needs is which of the
 * handful of real causes it was. Anything unrecognised keeps its original text
 * rather than being flattened into a friendly non-answer — a wrong specific
 * reason is worse than an unfamiliar true one.
 */
export function explainFailure(error: unknown): string {
  const named = decodeLaunchpadError(error);
  switch (named) {
    case "Slippage":
      return "The price moved past your slippage while this was being signed. Try again for a fresh quote.";
    case "Expired":
      return "This quote expired before it was submitted. Try again for a fresh one.";
    case "CurveComplete":
      return "This curve has filled. It graduates to its AMM pair next.";
    case "CurveNotComplete":
      return "The curve has not filled yet, so it cannot graduate.";
    case "AlreadyGraduated":
      return "This coin has already graduated.";
    case "InsufficientLiquidity":
      return "There is not enough in this pool to buy that back. Try a smaller amount.";
    case "QuoteNotAllowed":
      return "The launchpad does not accept that quote token.";
    case "BadMetadata":
      return "The name, ticker or metadata link is too long or empty.";
    case "SupplyExceeded":
    case "BadCurve":
      return "That curve does not fit the fixed supply. Try a different valuation.";
    case "NotCreator":
      return "Only the creator can claim this coin's fees.";
    case "ZeroAmount":
      return "That amount is too small to trade.";
    case "PairLocked":
      return "Tokens cannot be sent to the AMM pair until the coin graduates.";
    default:
      break;
  }

  const text = error instanceof BaseError ? error.shortMessage + "\n" + error.details : String((error as Error)?.message ?? error);
  // Monad's RPC says "insufficient balance" (not geth's "insufficient funds"),
  // which viem does not map to its own InsufficientFundsError.
  if (/insufficient (funds|balance)|exceeds (the )?balance|balance too low/i.test(text)) {
    return "Not enough MON in this wallet to cover the trade and its gas.";
  }
  if (/reserve balance/i.test(text)) {
    return "Monad keeps a small reserve of MON in every account for gas. Try a slightly smaller amount.";
  }
  if (/nonce too low|already known|replacement transaction/i.test(text)) {
    return "This transaction was already submitted, or a newer one replaced it. Refresh and try again.";
  }
  if (/nonce too high/i.test(text)) {
    return "An earlier transaction from this wallet has not landed yet. Wait a moment and try again.";
  }
  if (/invalid signature|invalid sender/i.test(text)) {
    return "The signature on this transaction did not verify. Try again.";
  }

  const first = error instanceof BaseError ? error.shortMessage : text.split("\n")[0];
  return first && first.trim().length > 0
    ? `The network refused this transaction: ${first.trim()}`
    : "The network refused this transaction.";
}

/** Every custom error a Juno transaction can revert with. */
const JUNO_ERRORS = [...junoLaunchpadAbi, ...junoTokenAbi].filter((item) => item.type === "error");

/**
 * The custom error name buried in a viem error, if there is one.
 *
 * Two shapes reach here. A `readContract`/`simulate` failure has already been
 * decoded against an ABI and carries `data.errorName`. An `estimateGas` or
 * `sendRawTransaction` failure carries only the raw revert bytes, somewhere in
 * its cause chain, and is decoded here against the launchpad's and the token's
 * errors.
 */
function decodeLaunchpadError(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  let name: string | null = null;
  let raw: Hex | null = null;
  error.walk((cause) => {
    const data = (cause as { data?: unknown }).data;
    if (data && typeof data === "object" && typeof (data as { errorName?: unknown }).errorName === "string") {
      name = (data as { errorName: string }).errorName;
      return true;
    }
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      raw = data as Hex;
      return true;
    }
    return false;
  });
  if (name) return name;
  if (!raw) return null;
  try {
    return decodeErrorResult({ abi: JUNO_ERRORS, data: raw }).errorName;
  } catch {
    return null;
  }
}
