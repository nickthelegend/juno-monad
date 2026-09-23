import { describe, expect, it } from "vitest";
import { getAbiItem, zeroAddress, type Address, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { junoLaunchpadAbi } from "@/lib/juno/abi";
import { publicClient } from "@/lib/juno/client";
import {
  BASE_DECIMALS,
  CURVE_SEGMENTS,
  DEFAULT_TOTAL_SUPPLY,
  FEE_PERIODS,
  MAX_FEE_BPS,
  MIN_FEE_BPS,
  validateCurveParams,
  type CurveParams,
} from "@/lib/juno/curves";
import { MON, fetchPoolSnapshot, quoteTokenOfPool } from "@/lib/juno/launchpad";
import { chainId, launchpadAddress, NATIVE } from "@/lib/juno/network";
import { decodeTradeLog } from "@/lib/juno/swaps";
import { buildLaunch, buildSwap } from "@/lib/juno/tx";
import { readScriptKey } from "../../scripts/lib/key";
import { unlessThrottled } from "../helpers/throttle";

/**
 * The deployed launchpad, read live. Nothing is sent.
 *
 * Runs only when `NEXT_PUBLIC_JUNO_LAUNCHPAD` names a deployment. Checks that
 * the contract the app is pointed at is the contract the app was written for —
 * its constants match `lib/juno/curves.ts`, its pools read back into snapshots,
 * its `Trade` logs decode — and, when a funded script key is present, that the
 * transactions the phone would sign are accepted by the chain's own gas
 * estimate. Those are built by `lib/juno/tx.ts` exactly as the API builds
 * them, and never signed or submitted.
 */

const launchpad = launchpadAddress();

if (!launchpad) {
  describe("juno launchpad (live)", () => {
    it.skip("skipped: NEXT_PUBLIC_JUNO_LAUNCHPAD is not set — deploy contracts/ and set it to run this suite", () => {});
  });
}

/** Enough to pay for a small first buy and the gas on top. */
const MIN_BALANCE = 2n * 10n ** 17n; // 0.2 MON

describe.skipIf(!launchpad)("juno launchpad (live)", () => {
  const address = launchpad as Address;
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    publicClient().readContract({ address, abi: junoLaunchpadAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

  it("is a contract on this chain", async () => {
    await unlessThrottled("launchpad code", async () => {
      const code = await publicClient().getCode({ address });
      expect(code && code.length > 2, `no contract at ${address} on chain ${chainId()}`).toBe(true);
    });
  });

  it("enforces the constants the app builds curves for", async () => {
    await unlessThrottled("launchpad constants", async () => {
      expect(await read<bigint>("SEGMENTS")).toBe(BigInt(CURVE_SEGMENTS));
      expect(await read<bigint>("TOTAL_SUPPLY")).toBe(BigInt(DEFAULT_TOTAL_SUPPLY) * 10n ** BigInt(BASE_DECIMALS));
      expect(await read<bigint>("FEE_PERIODS")).toBe(BigInt(FEE_PERIODS));
      expect(Number(await read<number>("MIN_FEE_BPS"))).toBe(MIN_FEE_BPS);
      expect(Number(await read<number>("MAX_FEE_BPS"))).toBe(MAX_FEE_BPS);
      expect(await read<Address>("NATIVE")).toBe(NATIVE);
      // Posts launch against MON; a launchpad that refuses it refuses the app's default.
      expect(await read<boolean>("allowedQuote", [MON.address])).toBe(true);
    });
  });

  it("reads its token count and the newest pool back into a snapshot", async () => {
    await unlessThrottled("newest pool", async () => {
      const count = await read<bigint>("tokenCount");
      console.info(`launchpad ${address}: ${count} token(s)`);
      if (count === 0n) return;

      const token = await read<Address>("tokens", [count - 1n]);
      const snapshot = await fetchPoolSnapshot(token);
      expect(snapshot, `tokens(${count - 1n}) = ${token} has no pool`).not.toBeNull();
      expect(snapshot!.segments).toHaveLength(CURVE_SEGMENTS);
      expect(snapshot!.price).toBeGreaterThan(0);
      expect(snapshot!.curve.progress).toBeGreaterThanOrEqual(0);
      expect(snapshot!.curve.progress).toBeLessThanOrEqual(1);

      // The curve on-chain passes the same validation the builder applies.
      const pool = snapshot!.pool;
      const onChain: CurveParams = {
        preset: pool.preset,
        sqrtStartPriceX96: pool.sqrtStartPriceX96,
        curve: snapshot!.segments,
        startFeeBps: pool.startFeeBps,
        endFeeBps: pool.endFeeBps,
        feeDecaySeconds: pool.feeDecaySeconds,
        feeDecayWad: pool.feeDecayWad,
        totals: { curveBase: 0n, threshold: pool.migrationQuoteThreshold, migrationBase: pool.migrationBase },
      };
      expect(validateCurveParams(onChain)).toBeNull();
    });
  });

  it("decodes whatever Trade logs the recent blocks hold", async () => {
    await unlessThrottled("recent trade logs", async () => {
      const latest = await publicClient().getBlockNumber();
      const logs = (await publicClient().getLogs({
        address,
        event: getAbiItem({ abi: junoLaunchpadAbi, name: "Trade" }),
        fromBlock: latest > 99n ? latest - 99n : 0n,
        toBlock: latest,
      })) as Log[];
      console.info(`${logs.length} Trade log(s) in the last 100 blocks`);
      for (const log of logs) {
        const token = `0x${log.topics[1]!.slice(26)}` as Address;
        const quote = await quoteTokenOfPool(token, address);
        const swap = decodeTradeLog(log, quote!.decimals, Math.floor(Date.now() / 1000));
        expect(swap, `log ${log.transactionHash}:${log.logIndex} did not decode`).not.toBeNull();
        expect(swap!.baseAmount).toBeGreaterThan(0);
        expect(swap!.quoteAmount).toBeGreaterThan(0);
      }
    });
  });

  it("accepts a launch and a buy built for a funded wallet (gas estimated, nothing sent)", async (ctx) => {
    const key = readScriptKey();
    if (!key) {
      console.info("skipped: no JUNO_SCRIPT_PRIVATE_KEY or .juno/launcher.key");
      ctx.skip();
      return;
    }
    const wallet = privateKeyToAccount(key).address;
    const balance = await publicClient().getBalance({ address: wallet });
    if (balance < MIN_BALANCE) {
      console.info(`skipped: ${wallet} holds ${balance} wei; fund it at https://faucet.monad.xyz`);
      ctx.skip();
      return;
    }

    await unlessThrottled("build launch + buy", async () => {
      // A launch with a small first buy, sized in MON so no price feed is needed.
      const launch = await buildLaunch({
        creator: wallet,
        name: "Juno Integration",
        symbol: "JUNOIT",
        uri: "",
        preset: "content",
        quote: zeroAddress,
        initialMarketCap: 40_000,
        migrationMarketCap: 1_000_000,
        firstBuy: 0.01,
      });
      expect(launch.steps).toHaveLength(1);
      const step = launch.steps[0].request;
      expect(step.chainId).toBe(chainId());
      expect(step.to).toBe(address);
      expect(step.from).toBe(wallet);
      expect(BigInt(step.gas)).toBeGreaterThan(21_000n);
      expect(BigInt(step.value)).toBe(10n ** 16n);
      expect(launch.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
      console.info(`launch would deploy ${launch.token} for ${BigInt(step.gas)} gas`);

      // A buy on the newest MON-quoted pool that is still trading, if there is one.
      const count = await read<bigint>("tokenCount");
      for (let i = count - 1n; i >= 0n && i >= count - 10n; i--) {
        const token = await read<Address>("tokens", [i]);
        const snapshot = await fetchPoolSnapshot(token);
        if (!snapshot || !snapshot.quote.native || snapshot.curve.complete || snapshot.curve.graduated) continue;
        const swap = await buildSwap({ token, side: "buy", amountIn: 0.01, owner: wallet });
        expect(swap.steps).toHaveLength(1);
        expect(BigInt(swap.steps[0].request.gas)).toBeGreaterThan(21_000n);
        expect(swap.quote.amountOut).toBeGreaterThan(0);
        console.info(`buy on ${token} would take ${BigInt(swap.steps[0].request.gas)} gas`);
        return;
      }
      console.info("no MON-quoted pool is still trading; the buy was not built");
    });
  }, 60_000);
});
