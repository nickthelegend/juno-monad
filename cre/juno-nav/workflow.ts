import {
  bytesToHex,
  ConsensusAggregationByFields,
  type CronPayload,
  cre,
  encodeCallMsg,
  getNetwork,
  type HTTPSendRequester,
  identical,
  LAST_FINALIZED_BLOCK_NUMBER,
  median,
  prepareReportRequest,
  type Runtime,
  text,
  TxStatus,
} from "@chainlink/cre-sdk";
import { type Address, decodeFunctionResult, encodeFunctionData, type Hex, keccak256, stringToBytes, zeroAddress } from "viem";
import { z } from "zod";

import { aggregatorAbi, launchpadAbi, pythAbi } from "./abis";
import {
  curvePriceE18,
  encodeReport,
  feedToE18,
  impliedUsdE18,
  type NavPoint,
  premiumBps,
  pythToE18,
  usdToE18,
  withinBand,
} from "./nav";

/**
 * juno-nav: Chainlink CRE as the oracle layer for Juno's tracker coins.
 *
 * A tracker coin (the `tight-nav` curve preset) stands for a fixed amount of
 * an underlying: a share of a listed stock, or a pre-IPO company as Tessera
 * marks it. Every run:
 *
 *  1. HTTP with consensus: each pre-IPO underlying's mark from Tessera's
 *     public API. Every node reads it; the DON keeps the median mark and
 *     requires the same token id.
 *  2. EVM reads on Monad, at the last finalized block:
 *     - MON/USD, and any listed underlying, from Pyth's contract on Monad;
 *     - USDC/USD from Chainlink's data feed, for coins quoted in USDC;
 *     - each coin's pool from `JunoLaunchpad`: its Q96 curve price, its
 *       quote token, whether it has graduated.
 *  3. The curve's implied price per unit of the underlying, and its premium
 *     to NAV, in integers.
 *  4. One signed report to `JunoNavOracle` on Monad, which keeps the latest
 *     attestation per coin and refuses older or replayed reports.
 *
 * A coin that has left its curve (graduated) is skipped and logged: its price
 * lives on its pair or book now, not on the launchpad.
 */

export const configSchema = z.object({
  schedule: z.string(),
  chainSelectorName: z.string(),
  isTestnet: z.boolean().default(true),
  launchpad: z.string(),
  receiver: z.string(),
  /** Pyth's contract on the same chain. */
  pyth: z.string(),
  monUsdFeed: z.string(),
  /** Chainlink's USDC/USD data feed on the same chain. */
  usdcUsdFeed: z.string(),
  usdc: z.string(),
  tesseraUrl: z.string(),
  gasLimit: z.string(),
  trackers: z
    .array(
      z.object({
        token: z.string(),
        /** `pyth`: `ref` is a Pyth feed id. `tessera`: `ref` is a Tessera token id (`T-SpaceX`). */
        source: z.enum(["pyth", "tessera"]),
        ref: z.string(),
        /** How much of the underlying one token stands for, 18 decimals. */
        unitsPerTokenE18: z.string(),
        bandBps: z.number().int().positive(),
      }),
    )
    .min(1),
});

export type Config = z.infer<typeof configSchema>;

/** One Tessera mark as the DON agrees on it. */
export type TesseraReading = { id: string; markPrice: number };

/** Runs on every node: one read of Tessera's public marks. The DON aggregates the readings. */
export const readTessera = (sendRequester: HTTPSendRequester, url: string, id: string): TesseraReading => {
  const response = sendRequester.sendRequest({ url: `${url}/token-details`, method: "GET" }).result();
  if (response.statusCode !== 200) throw new Error(`Tessera answered ${response.statusCode}`);
  const rows = JSON.parse(text(response)) as Array<{ id: string; markPrice: number }>;
  const row = rows.find((item) => item.id.toLowerCase() === id.toLowerCase());
  if (!row || !Number.isFinite(row.markPrice)) throw new Error(`Tessera has no mark for ${id}`);
  return { id: row.id, markPrice: row.markPrice };
};

const tesseraAggregation = ConsensusAggregationByFields<TesseraReading>({ id: identical, markPrice: median });

type Client = InstanceType<typeof cre.capabilities.EVMClient>;

function evmClient(config: Config): Client {
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName, isTestnet: config.isTestnet });
  if (!network) throw new Error(`Unknown chain ${config.chainSelectorName}`);
  return new cre.capabilities.EVMClient(network.chainSelector.selector);
}

function call(runtime: Runtime<Config>, client: Client, to: string, data: Hex): Hex {
  const reply = client
    .callContract(runtime, {
      call: encodeCallMsg({ from: zeroAddress, to: to as Address, data }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  return bytesToHex(reply.data) as Hex;
}

const feedId = (id: string) => (id.startsWith("0x") ? id : `0x${id}`) as Hex;

/** A Pyth price from Pyth's contract on Monad: USD 18 decimals and its publish time. */
export function pythPrice(runtime: Runtime<Config>, client: Client, id: string): { usdE18: bigint; publishTime: bigint } {
  const price = decodeFunctionResult({
    abi: pythAbi,
    functionName: "getPriceUnsafe",
    data: call(runtime, client, runtime.config.pyth, encodeFunctionData({ abi: pythAbi, functionName: "getPriceUnsafe", args: [feedId(id)] })),
  });
  if (price.price <= 0n) throw new Error(`Pyth has no positive price for ${id}`);
  return { usdE18: pythToE18(price.price, price.expo), publishTime: price.publishTime };
}

/** USDC/USD from Chainlink's data feed on Monad, 18 decimals. */
export function usdcUsdE18(runtime: Runtime<Config>, client: Client): bigint {
  const feed = runtime.config.usdcUsdFeed;
  const decimals = decodeFunctionResult({
    abi: aggregatorAbi,
    functionName: "decimals",
    data: call(runtime, client, feed, encodeFunctionData({ abi: aggregatorAbi, functionName: "decimals" })),
  });
  const [, answer] = decodeFunctionResult({
    abi: aggregatorAbi,
    functionName: "latestRoundData",
    data: call(runtime, client, feed, encodeFunctionData({ abi: aggregatorAbi, functionName: "latestRoundData" })),
  });
  if (answer <= 0n) throw new Error("Chainlink USDC/USD answered a non-positive price");
  return feedToE18(answer, decimals);
}

export function buildPoints(runtime: Runtime<Config>): NavPoint[] {
  const config = runtime.config;
  const client = evmClient(config);
  const http = new cre.capabilities.HTTPClient();
  const now = BigInt(Math.floor(runtime.now().getTime() / 1000));

  const mon = pythPrice(runtime, client, config.monUsdFeed);
  runtime.log(`MON/USD ${mon.usdE18} (Pyth on Monad, published ${mon.publishTime})`);
  let usdcUsd: bigint | null = null;

  const points: NavPoint[] = [];
  for (const tracker of config.trackers) {
    const pool = decodeFunctionResult({
      abi: launchpadAbi,
      functionName: "getPool",
      data: call(runtime, client, config.launchpad, encodeFunctionData({ abi: launchpadAbi, functionName: "getPool", args: [tracker.token as Address] })),
    });
    if (pool.creator === zeroAddress) {
      runtime.log(`${tracker.token}: not a Juno coin on this launchpad, skipped`);
      continue;
    }
    if (pool.graduated) {
      runtime.log(`${tracker.token}: graduated, its price is on its venue now, skipped`);
      continue;
    }
    const usdcQuote = pool.quote.toLowerCase() === config.usdc.toLowerCase();
    if (usdcQuote && usdcUsd === null) usdcUsd = usdcUsdE18(runtime, client);
    const quoteUsd = usdcQuote && usdcUsd !== null ? usdcUsd : mon.usdE18;
    const curve = curvePriceE18(pool.sqrtPriceX96, 18, usdcQuote ? 6 : 18);

    let nav: bigint;
    let publishedAt: bigint;
    let id: Hex;
    try {
      if (tracker.source === "tessera") {
        const reading = http.sendRequest(runtime, readTessera, tesseraAggregation)(config.tesseraUrl, tracker.ref).result();
        nav = usdToE18(reading.markPrice);
        // Tessera's API carries no timestamp: the time is when the DON read it.
        publishedAt = now;
        id = keccak256(stringToBytes(`tessera:${reading.id}`));
      } else {
        const price = pythPrice(runtime, client, tracker.ref);
        nav = price.usdE18;
        publishedAt = price.publishTime;
        id = feedId(tracker.ref);
      }
    } catch (error) {
      // One reference that cannot be read leaves that coin unattested, not the others.
      runtime.log(`${tracker.token}: no NAV (${error instanceof Error ? error.message : String(error)}), skipped`);
      continue;
    }

    const implied = impliedUsdE18(curve, quoteUsd, BigInt(tracker.unitsPerTokenE18));
    const premium = premiumBps(implied, nav);
    runtime.log(
      `${tracker.token}: NAV ${nav} implied ${implied} premium ${premium} bps (${withinBand(premium, tracker.bandBps) ? "inside" : "outside"} ${tracker.bandBps})`,
    );
    points.push({
      token: tracker.token as Address,
      feedId: id,
      navUsdE18: nav,
      navPublishTime: publishedAt,
      impliedUsdE18: implied,
      premiumBps: premium,
      bandBps: tracker.bandBps,
    });
  }
  return points;
}

export const onCron = (runtime: Runtime<Config>, _payload: CronPayload): string => {
  const points = buildPoints(runtime);
  if (points.length === 0) return "nothing to attest";
  // The DON's agreed time for this run, not a node's clock.
  const observedAt = BigInt(Math.floor(runtime.now().getTime() / 1000));
  const report = runtime.report(prepareReportRequest(encodeReport(observedAt, points))).result();
  const reply = evmClient(runtime.config)
    .writeReport(runtime, {
      receiver: runtime.config.receiver,
      report,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();
  if (reply.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${reply.errorMessage ?? reply.txStatus}`);
  const hash = bytesToHex(reply.txHash ?? new Uint8Array(32));
  runtime.log(`Attested ${points.length} coin(s) in ${hash}`);
  return hash;
};

export { aggregatorAbi, launchpadAbi, pythAbi };

export function initWorkflow(config: Config) {
  const cron = new cre.capabilities.CronCapability();
  return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)];
}
