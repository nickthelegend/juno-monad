import { describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  EstimateGasExecutionError,
  ExecutionRevertedError,
  InsufficientFundsError,
  InvalidInputRpcError,
  NonceTooLowError,
  RawContractError,
  RpcRequestError,
  encodeErrorResult,
  type Hex,
} from "viem";

import { junoLaunchpadAbi } from "@/lib/juno/abi";
import { explainFailure } from "@/lib/juno/tx";

/**
 * A refused transaction, said in a sentence.
 *
 * The launchpad reverts with named custom errors, and what someone buying $2
 * of a coin needs is which of the handful of real causes it was — not a
 * selector. These are the shapes viem actually hands back: a decoded revert
 * from a read, raw revert data from a gas estimate against a public RPC, and a
 * node's own refusal. Anything unrecognised must keep its original text, since
 * a wrong specific reason is worse than an unfamiliar true one.
 */

const LAUNCHPAD = "0x1111111111111111111111111111111111111111" as const;

type LaunchpadError = Parameters<typeof encodeErrorResult<typeof junoLaunchpadAbi>>[0]["errorName"];

function revertData(errorName: string, args?: readonly unknown[]): Hex {
  return encodeErrorResult({
    abi: junoLaunchpadAbi,
    errorName: errorName as LaunchpadError,
    args: args as never,
  });
}

/** What `readContract` / `simulateContract` throws: the revert already decoded. */
function decodedRevert(errorName: string, args?: readonly unknown[]): BaseError {
  const reverted = new ContractFunctionRevertedError({
    abi: junoLaunchpadAbi,
    data: revertData(errorName, args),
    functionName: "buy",
  });
  return new ContractFunctionExecutionError(reverted, {
    abi: junoLaunchpadAbi,
    functionName: "buy",
    args: [LAUNCHPAD, 1n, 1n, LAUNCHPAD, 1n],
    contractAddress: LAUNCHPAD,
  });
}

/** A JSON-RPC error body, as a node returns it. */
function rpcError(code: number, message: string, data?: Hex): RpcRequestError {
  return new RpcRequestError({
    body: { method: "eth_estimateGas" },
    error: { code, message, data },
    url: "https://testnet-rpc.monad.xyz",
  });
}

/** What `estimateGas` throws against a JSON-RPC node: raw revert bytes, several causes deep. */
function estimateRevert(errorName: string, args?: readonly unknown[]): BaseError {
  const rpc = rpcError(3, "execution reverted", revertData(errorName, args));
  return new EstimateGasExecutionError(new ExecutionRevertedError({ cause: rpc, message: rpc.details }), {});
}

describe("explainFailure: the launchpad's own errors", () => {
  it.each([
    ["Slippage", [10n, 20n], /price moved past your slippage/],
    ["Expired", undefined, /quote expired/],
    ["CurveComplete", undefined, /curve has filled/],
    ["CurveNotComplete", undefined, /has not filled yet/],
    ["AlreadyGraduated", undefined, /already graduated/],
    ["InsufficientLiquidity", undefined, /not enough in this pool/],
    ["QuoteNotAllowed", undefined, /does not accept that quote token/],
    ["BadMetadata", undefined, /name, ticker or metadata/],
    ["SupplyExceeded", [10n ** 27n], /does not fit the fixed supply/],
    ["BadCurve", undefined, /does not fit the fixed supply/],
    ["NotCreator", undefined, /Only the creator/],
    ["ZeroAmount", undefined, /too small to trade/],
  ] as const)("%s, decoded by a read", (name, args, sentence) => {
    expect(explainFailure(decodedRevert(name, args))).toMatch(sentence);
  });

  it.each([
    ["Slippage", [1n, 2n], /price moved past your slippage/],
    ["Expired", undefined, /quote expired/],
    ["CurveComplete", undefined, /curve has filled/],
  ] as const)("%s, as raw bytes from a gas estimate", (name, args, sentence) => {
    expect(explainFailure(estimateRevert(name, args))).toMatch(sentence);
  });

  it("finds raw revert data however deep it is wrapped", () => {
    const nested = new BaseError("Execution reverted", {
      cause: new BaseError("Call failed", { cause: new RawContractError({ data: revertData("Expired") }) }),
    });
    expect(explainFailure(nested)).toMatch(/quote expired/);
  });

  it("passes through a revert it can decode but has no sentence for", () => {
    // ZeroLiquidity is a real launchpad error, just not one a trader can act
    // on. It must not be flattened into a friendlier wrong answer.
    const message = explainFailure(decodedRevert("ZeroLiquidity"));
    expect(message).toMatch(/^The network refused this transaction/);
    expect(message).not.toMatch(/slippage|expired|filled/i);
  });

  it("passes through revert data from some other contract", () => {
    const foreign = new BaseError("Execution reverted", { cause: new RawContractError({ data: "0xdeadbeef" }) });
    expect(explainFailure(foreign)).toBe("The network refused this transaction: Execution reverted");
  });
});

describe("explainFailure: the node's refusals", () => {
  it("explains insufficient funds as a geth-style node reports it", () => {
    // viem recognises this text and wraps it in its own InsufficientFundsError.
    const node = new InsufficientFundsError({
      cause: rpcError(-32003, "Insufficient funds for gas * price + value"),
    });
    expect(explainFailure(node)).toBe("Not enough MON in this wallet to cover the trade and its gas.");
  });

  it("explains insufficient funds as Monad's RPC reports it on a gas estimate", () => {
    // Measured against testnet-rpc.monad.xyz: `eth_estimateGas` from an
    // underfunded wallet answers -32000 "insufficient balance", which viem does
    // NOT map to InsufficientFundsError — it surfaces as "Missing or invalid
    // parameters". Before this case was handled, an empty wallet trying to buy
    // was told its parameters were wrong.
    const refusal = new EstimateGasExecutionError(new InvalidInputRpcError(rpcError(-32000, "insufficient balance")), {});
    expect(refusal.shortMessage).toMatch(/Missing or invalid parameters/);
    expect(explainFailure(refusal)).toBe("Not enough MON in this wallet to cover the trade and its gas.");
  });

  it("explains viem's insufficient-funds error even with no node text behind it", () => {
    expect(explainFailure(new InsufficientFundsError())).toBe(
      "Not enough MON in this wallet to cover the trade and its gas.",
    );
  });

  it("explains a plain-text insufficient balance", () => {
    expect(explainFailure(new Error("sender balance too low"))).toMatch(/Not enough MON/);
  });

  it("explains Monad's reserve balance", () => {
    const refusal = new BaseError("Transaction rejected", {
      details: "transaction would leave the account below its reserve balance",
    });
    expect(explainFailure(refusal)).toMatch(/reserve of MON/);
  });

  it("explains a stale or replaced nonce", () => {
    expect(explainFailure(new NonceTooLowError({ cause: rpcError(-32000, "nonce too low") }))).toMatch(
      /already submitted/,
    );
    expect(explainFailure(new Error("replacement transaction underpriced"))).toMatch(/already submitted/);
    expect(explainFailure(new Error("nonce too high"))).toMatch(/has not landed yet/);
  });

  it("explains a bad signature", () => {
    expect(explainFailure(new Error("invalid sender"))).toMatch(/did not verify/);
  });
});

describe("explainFailure: anything else keeps its own words", () => {
  it("passes an unfamiliar viem error through by its short message", () => {
    expect(explainFailure(new BaseError("Block gas limit exceeded", { details: "long node text" }))).toBe(
      "The network refused this transaction: Block gas limit exceeded",
    );
  });

  it("passes a plain error through by its first line", () => {
    expect(explainFailure(new Error("something odd\nstack-ish detail"))).toBe(
      "The network refused this transaction: something odd",
    );
  });

  it("copes with a thrown string and with nothing at all", () => {
    expect(explainFailure("boom")).toBe("The network refused this transaction: boom");
    expect(explainFailure(new Error(""))).toBe("The network refused this transaction.");
  });
});
