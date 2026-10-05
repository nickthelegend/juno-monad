/**
 * One juno-nav run on a LOCAL FORK of Monad testnet, without the CRE CLI.
 *
 *   FORK_RPC=http://127.0.0.1:8555 FORK_PRIVATE_KEY=0x… bun fork-attest.ts config.local-fork.json
 *
 * The same arithmetic and report encoding as the workflow (`nav.ts`), on live
 * readings: Tessera's public marks, and on the fork Pyth's contract, the
 * launchpad and Chainlink's USDC/USD feed. The report is delivered the way `cre workflow simulate --broadcast`
 * delivers it, through Monad testnet's MockKeystoneForwarder
 * (`report(receiver, rawReport, reportContext, signatures)`), which calls
 * `JunoNavOracle.onReport`. What it does not stand in for: the DON. One process
 * reads once; there is no consensus across nodes. Refuses any RPC that is not
 * on this machine.
 */

import {
  type Address,
  concat,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  parseAbi,
  sha256,
  stringToBytes,
  stringToHex,
  toHex,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { aggregatorAbi, launchpadAbi, pythAbi } from "./abis";
import { curvePriceE18, encodeReport, feedToE18, impliedUsdE18, type NavPoint, premiumBps, pythToE18, usdToE18, withinBand } from "./nav";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8555";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC)) throw new Error("fork-attest only runs against a local fork");
const FORWARDER = "0xB9F79d863261869B234c481D1f9A7af84AeAd192" as Address;
const config = await Bun.file(process.argv[2] ?? "config.local-fork.json").json();

const client = createPublicClient({ transport: http(RPC) });
const oracleAbi = parseAbi([
  "struct Attestation { bytes32 feedId; uint256 navUsdE18; uint256 impliedUsdE18; int256 premiumBps; uint64 navPublishTime; uint64 observedAt; uint16 bandBps; bool withinBand; }",
  "function navOf(address token) view returns (Attestation)",
  "function reportCount() view returns (uint256)",
]);
const forwarderAbi = parseAbi(["function report(address receiver, bytes rawReport, bytes reportContext, bytes[] signatures)"]);

const hex32 = (id: string) => `0x${id.replace(/^0x/, "")}` as Hex;

async function pyth(id: string) {
  const price = await client.readContract({ address: config.pyth, abi: pythAbi, functionName: "getPriceUnsafe", args: [hex32(id)] });
  return { usdE18: pythToE18(price.price, price.expo), publishTime: price.publishTime };
}

async function tessera(id: string) {
  const response = await fetch(`${config.tesseraUrl}/token-details`);
  if (!response.ok) throw new Error(`Tessera answered ${response.status}`);
  const row = ((await response.json()) as Array<{ id: string; markPrice: number }>).find((r) => r.id.toLowerCase() === id.toLowerCase());
  if (!row) throw new Error(`Tessera has no mark for ${id}`);
  return row;
}

/** The workflow name as CRE encodes it in metadata: sha256, hex, first ten characters. */
const workflowName = (name: string) => stringToHex(sha256(stringToBytes(name)).slice(2, 12), { size: 10 });

async function main() {
  const monUsd = (await pyth(config.monUsdFeed)).usdE18;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const points: NavPoint[] = [];
  for (const tracker of config.trackers) {
    const pool = await client.readContract({ address: config.launchpad, abi: launchpadAbi, functionName: "getPool", args: [tracker.token] });
    if (pool.creator === zeroAddress || pool.graduated) continue;
    const usdcQuote = pool.quote.toLowerCase() === config.usdc.toLowerCase();
    let quoteUsd = monUsd;
    if (usdcQuote) {
      const [decimals, round] = await Promise.all([
        client.readContract({ address: config.usdcUsdFeed, abi: aggregatorAbi, functionName: "decimals" }),
        client.readContract({ address: config.usdcUsdFeed, abi: aggregatorAbi, functionName: "latestRoundData" }),
      ]);
      quoteUsd = feedToE18(round[1], decimals);
    }
    let nav: bigint;
    let publishedAt: bigint;
    let feedId: Hex;
    try {
      if (tracker.source === "tessera") {
        const row = await tessera(tracker.ref);
        nav = usdToE18(row.markPrice);
        publishedAt = now;
        feedId = keccak256(stringToBytes(`tessera:${row.id}`));
      } else {
        const price = await pyth(tracker.ref);
        nav = price.usdE18;
        publishedAt = price.publishTime;
        feedId = hex32(tracker.ref);
      }
    } catch (error) {
      console.log(`${tracker.token}: no NAV (${error instanceof Error ? error.message.split("\n")[0] : error}), skipped`);
      continue;
    }
    const implied = impliedUsdE18(curvePriceE18(pool.sqrtPriceX96, 18, usdcQuote ? 6 : 18), quoteUsd, BigInt(tracker.unitsPerTokenE18));
    const premium = premiumBps(implied, nav);
    console.log(`${tracker.token}: NAV $${Number(nav) / 1e18} implied $${Number(implied) / 1e18} premium ${premium} bps (${withinBand(premium, tracker.bandBps) ? "inside" : "outside"} ${tracker.bandBps})`);
    points.push({
      token: tracker.token,
      feedId,
      navUsdE18: nav,
      navPublishTime: publishedAt,
      impliedUsdE18: implied,
      premiumBps: premium,
      bandBps: tracker.bandBps,
    });
  }
  if (points.length === 0) return console.log("nothing to attest");

  const account = privateKeyToAccount(process.env.FORK_PRIVATE_KEY as Hex);
  const observedAt = BigInt(Math.floor(Date.now() / 1000));
  // KeystoneForwarder's 109-byte header: version, execution id, timestamp, DON id, config version,
  // workflow id, workflow name, workflow owner, report id. Then the payload.
  const header = concat([
    toHex(1, { size: 1 }),
    keccak256(toHex(`juno-nav-${observedAt}`)),
    toHex(Number(observedAt), { size: 4 }),
    toHex(1, { size: 4 }),
    toHex(1, { size: 4 }),
    keccak256(stringToBytes("juno-nav")),
    workflowName("juno-nav"),
    account.address,
    toHex(1, { size: 2 }),
  ]);
  const rawReport = concat([header, encodeReport(observedAt, points)]);
  const wallet = createWalletClient({ account, transport: http(RPC) });
  const hash = await wallet.writeContract({
    chain: null,
    address: FORWARDER,
    abi: forwarderAbi,
    functionName: "report",
    args: [config.receiver, rawReport, "0x", []],
    // The forwarder catches a receiver that fails, so an estimate finds the gas at which the
    // outer call succeeds and starves `onReport`. CRE sends the workflow's gasLimit; so does this.
    gas: BigInt(config.gasLimit) + 100_000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  // KeystoneForwarder's ReportProcessed(receiver, workflowExecutionId, reportId, result): did onReport succeed?
  const processed = receipt.logs.find((log) => log.address.toLowerCase() === FORWARDER.toLowerCase());
  const delivered = processed ? BigInt(processed.data) === 1n : false;
  console.log(`report through MockKeystoneForwarder: ${hash} (${receipt.status}, block ${receipt.blockNumber}), onReport ${delivered ? "succeeded" : "FAILED"}`);
  if (!delivered) process.exitCode = 1;
  for (const point of points) {
    const a = await client.readContract({ address: config.receiver, abi: oracleAbi, functionName: "navOf", args: [point.token] });
    console.log(`JunoNavOracle.navOf(${point.token}): nav $${Number(a.navUsdE18) / 1e18}, premium ${a.premiumBps} bps, withinBand ${a.withinBand}, observedAt ${a.observedAt}`);
  }
  console.log(`reports accepted: ${await client.readContract({ address: config.receiver, abi: oracleAbi, functionName: "reportCount" })}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
