/**
 * Prove Juno's Perpl orders against live Monad testnet, without AUSD and
 * without sending anything.
 *
 * Testnet AUSD cannot be minted by the public, and Agora's faucet is dry as of
 * this writing, so a real account cannot be opened from here. This script does
 * the next best thing: it builds the exact calls the app would send — the AUSD
 * approval, `createAccount`, an immediate-or-cancel open and the matching
 * close — with the same `lib/juno/perpl.ts` functions the API uses, and runs
 * them in one `eth_simulateV1` block against live testnet state, from a fresh
 * address whose AUSD balance is overridden. Perpl's contract, its live marks
 * and its live order book are untouched.
 *
 *   npm run juno:perps-simulate -- [--perp 16] [--side long] [--collateral 150] [--leverage 2]
 *
 * Reads from MONAD_RPC_URL if set, else Monad's public testnet RPC; never from
 * a local fork (a fork's Perpl marks go stale within a minute).
 */

import { decodeErrorResult, encodeAbiParameters, keccak256, parseEventLogs, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { publicClient } from "../lib/juno/client";
import { perpCloseCall, perpDepositCalls, perpOpenCall, perpl } from "../lib/juno/perpl";
import { perplExchangeAbi } from "../lib/juno/perpl-abi";
import { arg, line, numberArg, run } from "./lib/cli";

/** Agora's namespaced ERC-20 storage (`ERC20_CORE_STORAGE_SLOT()`); balances are `balance << 8`, the low byte a freeze flag. */
const AUSD_CORE_SLOT = "0x455730fed596673e69db1907be2e521374ba893f1a04cc5f5dd931616cd6b700";

run(async () => {
  if (/127\.0\.0\.1|localhost/.test(process.env.MONAD_RPC_URL ?? "")) {
    throw new Error("Point MONAD_RPC_URL at live testnet, not a fork: a fork's Perpl marks are stale.");
  }
  const perpId = numberArg("perp", 16) ?? 16;
  const side = arg("side", "long") === "short" ? "short" : "long";
  const collateral = numberArg("collateral", 150) ?? 150;
  const leverage = numberArg("leverage", 2) ?? 2;

  const client = publicClient();
  const trader = privateKeyToAccount(generatePrivateKey()).address;
  const { ausd } = perpl();
  const deposit = Math.max(collateral, 100);

  console.log(`\nPerpl on Monad testnet: ${side} perp ${perpId}, ${collateral} AUSD at ${leverage}x (simulated, nothing sent)\n`);
  line("trader (fresh)", trader);

  const depositCalls = await perpDepositCalls(trader, deposit, false);
  const open = await perpOpenCall({ perpId, side, collateral, leverage, slippageBps: 100 });
  line("mark", `$${open.mark}`);
  line("size", `${open.size}`);
  line("worst price", `$${open.limitPrice}`);
  const close = await perpCloseCall({ perpId, position: { side, size: open.size }, slippageBps: 200 });

  const balanceSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [trader, AUSD_CORE_SLOT]));
  const calls = [...depositCalls, open.call, close].map((call) => ({ to: call.to, data: call.data, value: call.value }));

  const [block] = await client.simulateBlocks({
    blocks: [
      {
        stateOverrides: [
          { address: trader, balance: 10n ** 18n },
          { address: ausd as Address, stateDiff: [{ slot: balanceSlot, value: toHex(BigInt(deposit * 2 * 1e6) << 8n, { size: 32 }) }] },
        ],
        calls: calls.map((call) => ({ ...call, account: trader })),
      },
    ],
  });

  const labels = [...depositCalls.map((c) => c.label), open.call.label, close.label];
  console.log("");
  block.calls.forEach((result, index) => {
    const outcome = result.status === "success" ? "ok" : `REVERTED ${revertName(result.data)}`;
    console.log(`${labels[index]}: ${outcome}`);
    if (result.status !== "success") return;
    const events = parseEventLogs({ abi: perplExchangeAbi, logs: result.logs ?? [] });
    for (const event of events) {
      if (event.eventName === "PositionOpenedV2") {
        const args = event.args as { pricePNS: bigint; lotLNS: bigint; depositCNS: bigint };
        line("  opened", `lot ${args.lotLNS} at ${args.pricePNS} PNS, collateral ${Number(args.depositCNS) / 1e6} AUSD`);
      } else if (event.eventName === "PositionClosed") {
        const args = event.args as { pricePNS: bigint; deltaPnlCNS: bigint };
        line("  closed", `at ${args.pricePNS} PNS, P&L ${Number(args.deltaPnlCNS) / 1e6} AUSD`);
      } else if (event.eventName === "ImmediateOrCancelExecuted") {
        const args = event.args as { unmatchedLotLNS: bigint; totalLotLNS: bigint };
        line("  unfilled", `${args.unmatchedLotLNS} of ${args.totalLotLNS} lots`);
      } else if (event.eventName === "AccountCreated") {
        line("  account", `created`);
      }
    }
  });
  function revertName(data: Hex): string {
    try {
      const decoded = decodeErrorResult({ abi: perplExchangeAbi, data });
      return `${decoded.errorName}(${(decoded.args ?? []).map(String).join(", ")})`;
    } catch {
      return data.slice(0, 10);
    }
  }
  const failed = block.calls.filter((result) => result.status !== "success").length;
  if (failed > 0) throw new Error(`${failed} call(s) reverted`);
});
