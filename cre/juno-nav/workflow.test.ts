import { describe, expect } from "bun:test";
import { getNetwork } from "@chainlink/cre-sdk";
import { addContractMock, EvmMock, HttpActionsMock, newTestRuntime, REPORT_METADATA_HEADER_LENGTH, test } from "@chainlink/cre-sdk/test";
import { type Address, bytesToHex, decodeAbiParameters, getAddress, keccak256, stringToBytes, zeroAddress } from "viem";

import { curvePriceE18, E18, feedToE18, impliedUsdE18, navPointParams, premiumBps, pythToE18, usdToE18, withinBand } from "./nav";
import { aggregatorAbi, type Config, initWorkflow, launchpadAbi, onCron, pythAbi } from "./workflow";

const LAUNCHPAD = "0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81" as Address;
const RECEIVER = getAddress("0x00000000000000000000000000000000000000aa");
const USDC_FEED = "0x39820e7965e29DC86b94F20eD04e9c5cCf9aFf95" as Address;
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3" as Address;
const COIN = "0x975AfA7295D078e2D834124a9EA441BbcdBA9b48" as Address;
const USDC_COIN = getAddress("0x00000000000000000000000000000000000c0ffe");
const GRADUATED = "0x14092A529e2e5EB4DECB4a1828f6aFa72e026360" as Address;
const MON_FEED = "31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1";
const AAPL = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";

const PYTH = getAddress("0xfc6bd9f9f0c6481c6af3a7eb46b296a5b85ed379");
const TESSERA_COIN = getAddress("0x00000000000000000000000000000000005bace5");

const config: Config = {
  schedule: "0 */10 * * * *",
  chainSelectorName: "monad-testnet",
  isTestnet: true,
  launchpad: LAUNCHPAD,
  receiver: RECEIVER,
  pyth: PYTH,
  monUsdFeed: MON_FEED,
  usdcUsdFeed: USDC_FEED,
  usdc: USDC,
  tesseraUrl: "https://tessera.example/v1/public",
  gasLimit: "1000000",
  trackers: [
    // 0.001 AAPL per token, priced in MON.
    { token: COIN, source: "pyth", ref: AAPL, unitsPerTokenE18: (10n ** 15n).toString(), bandBps: 200 },
    // The same, priced in USDC.
    { token: USDC_COIN, source: "pyth", ref: AAPL, unitsPerTokenE18: (10n ** 15n).toString(), bandBps: 200 },
    // 0.0001 of a SpaceX T-token per token, marked by Tessera.
    { token: TESSERA_COIN, source: "tessera", ref: "T-SpaceX", unitsPerTokenE18: (10n ** 14n).toString(), bandBps: 200 },
    { token: GRADUATED, source: "pyth", ref: AAPL, unitsPerTokenE18: (10n ** 15n).toString(), bandBps: 200 },
  ],
};

function isqrt(n: bigint): bigint {
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** The Q96 square-root price for `price` quote per token (18 decimals each side unless quoteDecimals). */
const sqrtX96For = (priceE18: bigint, quoteDecimals = 18) => isqrt((priceE18 * 2n ** 192n * 10n ** BigInt(quoteDecimals)) / (E18 * E18));

const pool = (overrides: Partial<{ graduated: boolean; quote: Address; sqrtPriceX96: bigint; creator: Address }>) => ({
  creator: "0x019E55cb3ce46Ed3f439320Fb589833909C5CaaC" as Address,
  launchedAt: 1_790_000_000,
  preset: 3,
  complete: false,
  graduated: false,
  quote: zeroAddress,
  startFeeBps: 200,
  endFeeBps: 100,
  feeDecaySeconds: 300,
  protocolShareBps: 0,
  feeDecayWad: 0n,
  sqrtPriceX96: 0n,
  sqrtStartPriceX96: 0n,
  venue: zeroAddress,
  graduator: zeroAddress,
  baseReserve: 0n,
  quoteReserve: 0n,
  migrationBase: 0n,
  migrationQuoteThreshold: 0n,
  leftover: 0n,
  creatorFees: 0n,
  creatorFeesClaimed: 0n,
  ...overrides,
});

describe("NAV arithmetic", () => {
  test("a Q96 price matches Juno's float conversion", () => {
    const sqrt = sqrtX96For(8n * E18);
    const exact = curvePriceE18(sqrt, 18, 18);
    expect(Number(exact) / 1e18).toBeCloseTo(8, 9);
    // USDC (6 decimals) quote: 0.25 USDC per token.
    const usdc = curvePriceE18(sqrtX96For(25n * 10n ** 16n, 6), 18, 6);
    expect(Number(usdc) / 1e18).toBeCloseTo(0.25, 9);
  });

  test("Pyth and Chainlink scales", () => {
    expect(pythToE18(25_000_000_000n, -8)).toBe(250n * E18);
    expect(feedToE18(99_990_000n, 8)).toBe(9_999n * 10n ** 14n);
    expect(usdToE18(812.79)).toBe(81_279n * 10n ** 16n);
    expect(() => usdToE18(Number.NaN)).toThrow();
  });

  test("premium, signed, and the band edge", () => {
    // 8 MON at $0.0315 for 0.001 of a $250 share: $252 a share, +0.8%.
    const implied = impliedUsdE18(8n * E18, 315n * 10n ** 14n, 10n ** 15n);
    expect(implied).toBe(252n * E18);
    expect(premiumBps(implied, 250n * E18)).toBe(80n);
    expect(premiumBps(245n * E18, 250n * E18)).toBe(-200n);
    expect(withinBand(-200n, 200)).toBe(true);
    expect(withinBand(201n, 200)).toBe(false);
    expect(() => premiumBps(1n, 0n)).toThrow();
    expect(() => impliedUsdE18(1n, 1n, 0n)).toThrow();
  });
});

const pythMock = (evm: EvmMock) => {
  const pyth = addContractMock(evm, { address: PYTH, abi: pythAbi });
  pyth.getPriceUnsafe = (id: unknown) =>
    id === `0x${MON_FEED}`
      ? { price: 3_150_000n, conf: 0n, expo: -8, publishTime: 1_790_000_100n }
      : { price: 25_000_000_000n, conf: 0n, expo: -8, publishTime: 1_790_000_050n };
};

describe("onCron", () => {
  test("reads Pyth and Chainlink on Monad, Tessera over HTTP, the launchpad, and writes one report", () => {
    const network = getNetwork({ chainFamily: "evm", chainSelectorName: "monad-testnet", isTestnet: true });
    expect(network).toBeDefined();
    const evm = EvmMock.testInstance(network!.chainSelector.selector);
    pythMock(evm);

    const launchpad = addContractMock(evm, { address: LAUNCHPAD, abi: launchpadAbi });
    launchpad.getPool = (token: unknown) => {
      if (token === COIN) return pool({ sqrtPriceX96: sqrtX96For(8n * E18) });
      if (token === USDC_COIN) return pool({ quote: USDC, sqrtPriceX96: sqrtX96For(24n * 10n ** 16n, 6) });
      // 1.3 MON a token: 1.3 × $0.0315 / 0.0001 = $409.50 against Tessera's $423.
      if (token === TESSERA_COIN) return pool({ sqrtPriceX96: sqrtX96For(13n * 10n ** 17n) });
      return pool({ graduated: true });
    };
    const feed = addContractMock(evm, { address: USDC_FEED, abi: aggregatorAbi });
    feed.decimals = () => 8;
    feed.latestRoundData = () => [1n, 100_000_000n, 0n, 0n, 1n];

    let written: Uint8Array | null = null;
    const receiver = addContractMock(evm, { address: RECEIVER, abi: [] });
    receiver.writeReport = (input) => {
      written = input.report.rawReport;
      expect(input.gasConfig.gasLimit).toBe(1_000_000n);
      return { txStatus: "TX_STATUS_SUCCESS", txHash: new Uint8Array(32).fill(7) } as never;
    };

    const urls: string[] = [];
    const http = HttpActionsMock.testInstance();
    http.sendRequest = (request) => {
      urls.push(request.url);
      const rows = [
        { id: "T-OpenAI", markPrice: 812.79 },
        { id: "T-SpaceX", markPrice: 423 },
      ];
      return { statusCode: 200, body: new TextEncoder().encode(JSON.stringify(rows)) } as never;
    };

    const runtime = newTestRuntime(null, { timeProvider: () => 1_790_000_200_000 }, config);
    const hash = onCron(runtime as never, {} as never);
    expect(hash).toBe(bytesToHex(new Uint8Array(32).fill(7)));

    // Tessera once, for the one Tessera tracker; the graduated coin is skipped.
    expect(urls).toEqual(["https://tessera.example/v1/public/token-details"]);
    expect(runtime.getLogs().some((line) => line.includes("graduated"))).toBe(true);

    expect(written).not.toBeNull();
    const payload = bytesToHex(written!.slice(REPORT_METADATA_HEADER_LENGTH));
    const [observedAt, points] = decodeAbiParameters(navPointParams, payload);
    expect(observedAt).toBe(1_790_000_200n);
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ token: COIN, navUsdE18: 250n * E18, navPublishTime: 1_790_000_050n, bandBps: 200 });
    expect(points[0].feedId).toBe(`0x${AAPL}`);
    // 8 MON × $0.0315 per 0.001 share = $252: +80 bps (to within the Q96 rounding).
    expect(Number(points[0].impliedUsdE18) / 1e18).toBeCloseTo(252, 6);
    expect(points[0].premiumBps === 79n || points[0].premiumBps === 80n).toBe(true);
    // 0.24 USDC at Chainlink's $1.00 per 0.001 share = $240: −400 bps, outside the band.
    expect(Number(points[1].impliedUsdE18) / 1e18).toBeCloseTo(240, 6);
    expect(points[1].premiumBps === -400n || points[1].premiumBps === -399n).toBe(true);
    // Tessera: NAV $423 at the time the DON read it; implied $409.50, −319 bps.
    expect(points[2]).toMatchObject({ token: TESSERA_COIN, navUsdE18: 423n * E18, navPublishTime: 1_790_000_200n });
    expect(points[2].feedId).toBe(keccak256(stringToBytes("tessera:T-SpaceX")));
    expect(Number(points[2].impliedUsdE18) / 1e18).toBeCloseTo(409.5, 6);
    expect(points[2].premiumBps === -319n || points[2].premiumBps === -320n).toBe(true);
  });

  test("a reference that cannot be read skips that coin only", () => {
    const network = getNetwork({ chainFamily: "evm", chainSelectorName: "monad-testnet", isTestnet: true });
    const evm = EvmMock.testInstance(network!.chainSelector.selector);
    const pyth = addContractMock(evm, { address: PYTH, abi: pythAbi });
    pyth.getPriceUnsafe = (id: unknown) => {
      if (id === `0x${MON_FEED}`) return { price: 3_150_000n, conf: 0n, expo: -8, publishTime: 1n };
      throw new Error("PriceFeedNotFound");
    };
    const launchpad = addContractMock(evm, { address: LAUNCHPAD, abi: launchpadAbi });
    launchpad.getPool = () => pool({ sqrtPriceX96: sqrtX96For(13n * 10n ** 17n) });
    let points = -1;
    const receiver = addContractMock(evm, { address: RECEIVER, abi: [] });
    receiver.writeReport = (input) => {
      points = decodeAbiParameters(navPointParams, bytesToHex(input.report.rawReport.slice(REPORT_METADATA_HEADER_LENGTH)))[1].length;
      return { txStatus: "TX_STATUS_SUCCESS", txHash: new Uint8Array(32) } as never;
    };
    HttpActionsMock.testInstance().sendRequest = () =>
      ({ statusCode: 200, body: new TextEncoder().encode(JSON.stringify([{ id: "T-SpaceX", markPrice: 423 }])) }) as never;
    const runtime = newTestRuntime(null, {}, { ...config, trackers: [config.trackers[0], config.trackers[2]] });
    onCron(runtime as never, {} as never);
    expect(points).toBe(1);
    expect(runtime.getLogs().some((line) => line.includes("no NAV"))).toBe(true);
  });

  test("a coin the launchpad does not know is skipped, and an empty run writes nothing", () => {
    const network = getNetwork({ chainFamily: "evm", chainSelectorName: "monad-testnet", isTestnet: true });
    const evm = EvmMock.testInstance(network!.chainSelector.selector);
    pythMock(evm);
    const launchpad = addContractMock(evm, { address: LAUNCHPAD, abi: launchpadAbi });
    launchpad.getPool = () => pool({ creator: zeroAddress });
    const runtime = newTestRuntime(null, {}, { ...config, trackers: [config.trackers[0]] });
    expect(onCron(runtime as never, {} as never)).toBe("nothing to attest");
  });
});

describe("initWorkflow", () => {
  test("one cron handler on the configured schedule", () => {
    const handlers = initWorkflow(config);
    expect(handlers).toHaveLength(1);
    expect(handlers[0].fn).toBe(onCron);
    expect((handlers[0].trigger as { config?: { schedule?: string } }).config?.schedule).toBe(config.schedule);
  });
});
