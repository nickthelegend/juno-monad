import { afterEach, describe, expect, it } from "vitest";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  EstimateGasExecutionError,
  ExecutionRevertedError,
  InvalidInputRpcError,
  RpcRequestError,
  encodeErrorResult,
} from "viem";

import { junoLaunchpadAbi, junoTokenAbi } from "@/lib/juno/abi";
import { describeError } from "../../scripts/lib/cli";
import { readScriptKey } from "../../scripts/lib/key";

/**
 * The CLI scripts' error and key handling.
 *
 * A script user reads a failure in a terminal, so it has to name the
 * contract's own error when there is one and say how to get MON when that is
 * the problem. And the key it signs with must never appear in any output.
 */

function rpc(code: number, message: string, data?: `0x${string}`) {
  return new RpcRequestError({ body: {}, error: { code, message, data }, url: "https://testnet-rpc.monad.xyz" });
}

describe("describeError", () => {
  it("names a launchpad revert, with its arguments", () => {
    const data = encodeErrorResult({ abi: junoLaunchpadAbi, errorName: "Slippage", args: [5n, 9n] });
    const error = new EstimateGasExecutionError(new ExecutionRevertedError({ cause: rpc(3, "execution reverted", data) }), {});
    expect(describeError(error)).toBe("the launchpad refused with Slippage(5, 9)");
  });

  it("names an already-decoded revert", () => {
    const reverted = new ContractFunctionRevertedError({
      abi: junoLaunchpadAbi,
      data: encodeErrorResult({ abi: junoLaunchpadAbi, errorName: "CurveNotComplete" }),
      functionName: "graduate",
    });
    const error = new ContractFunctionExecutionError(reverted, {
      abi: junoLaunchpadAbi,
      functionName: "graduate",
      args: ["0x1111111111111111111111111111111111111111"],
    });
    expect(describeError(error)).toBe("the launchpad refused with CurveNotComplete");
  });

  it("names a token revert too — a sell of more than is held", () => {
    const data = encodeErrorResult({
      abi: junoTokenAbi,
      errorName: "ERC20InsufficientBalance",
      args: ["0x2222222222222222222222222222222222222222", 1n, 2n],
    });
    const error = new EstimateGasExecutionError(new ExecutionRevertedError({ cause: rpc(3, "execution reverted", data) }), {});
    expect(describeError(error)).toMatch(/^the launchpad refused with ERC20InsufficientBalance\(/);
  });

  it("turns Monad's insufficient balance into a funding hint", () => {
    const error = new EstimateGasExecutionError(new InvalidInputRpcError(rpc(-32000, "insufficient balance")), {});
    expect(describeError(error)).toMatch(/^not enough MON/);
  });

  it("keeps anything else in the node's own words", () => {
    expect(describeError(new BaseError("Block gas limit exceeded"))).toBe("Block gas limit exceeded");
    expect(describeError(new Error("plain"))).toBe("plain");
  });
});

describe("readScriptKey", () => {
  const saved = process.env.JUNO_SCRIPT_PRIVATE_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.JUNO_SCRIPT_PRIVATE_KEY;
    else process.env.JUNO_SCRIPT_PRIVATE_KEY = saved;
  });

  it("reads a key from the environment, with or without 0x", () => {
    const hex = "ab".repeat(32);
    process.env.JUNO_SCRIPT_PRIVATE_KEY = hex;
    expect(readScriptKey()).toBe(`0x${hex}`);
    process.env.JUNO_SCRIPT_PRIVATE_KEY = `0x${hex}`;
    expect(readScriptKey()).toBe(`0x${hex}`);
  });

  it("refuses a malformed key without echoing it", () => {
    const secretish = "not-a-key-but-could-have-been-one";
    process.env.JUNO_SCRIPT_PRIVATE_KEY = secretish;
    let message = "";
    try {
      readScriptKey();
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/JUNO_SCRIPT_PRIVATE_KEY is not a 32-byte hex private key/);
    expect(message).not.toContain(secretish);
  });
});
