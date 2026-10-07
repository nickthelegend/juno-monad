import { beforeEach, describe, expect, it } from "vitest";

import { ETHEREUM_BLOCK_SECONDS, ethereumFee, ethereumGasPrice, monadFee, resetEthereumGasPrice } from "@/lib/juno/tx-cost";

/**
 * The speed receipt's cost line: what Monad charged, and what the same gas
 * would cost on Ethereum mainnet now. These pin the rules that make the two
 * figures honest.
 */
describe("monadFee", () => {
  const base = { gasUsed: 120_000n, gasLimit: 180_000n, effectiveGasPrice: 50_000_000_000n, monUsd: 0.03 };

  it("bills the gas limit on Monad, as Monad does", () => {
    const fee = monadFee({ ...base, localFork: false });
    expect(fee.billed).toBe("limit");
    expect(fee.gasCharged).toBe(180_000);
    expect(fee.gasPriceGwei).toBe(50);
    expect(fee.feeMon).toBeCloseTo(0.009, 12);
    expect(fee.feeUsd).toBeCloseTo(0.00027, 12);
  });

  it("bills the gas used on an anvil fork, which follows Ethereum's rule", () => {
    const fee = monadFee({ ...base, localFork: true });
    expect(fee.billed).toBe("used");
    expect(fee.gasCharged).toBe(120_000);
    expect(fee.feeMon).toBeCloseTo(0.006, 12);
  });

  it("leaves the dollar figure out when MON/USD could not be read", () => {
    expect(monadFee({ ...base, monUsd: null, localFork: false }).feeUsd).toBeNull();
  });
});

describe("ethereumFee", () => {
  it("prices the same gas used at Ethereum's gas price and ETH/USD", () => {
    const fee = ethereumFee({ gasUsed: 120_000n, gasPriceWei: 2_000_000_000n, ethUsd: 4_000 });
    expect(fee.gasPriceGwei).toBe(2);
    expect(fee.feeEth).toBeCloseTo(0.00024, 12);
    expect(fee.feeUsd).toBeCloseTo(0.96, 9);
    expect(fee.blockSeconds).toBe(ETHEREUM_BLOCK_SECONDS);
  });

  it("keeps the ETH amount but drops the dollars without a price", () => {
    const fee = ethereumFee({ gasUsed: 120_000n, gasPriceWei: 2_000_000_000n, ethUsd: null });
    expect(fee.feeEth).toBeCloseTo(0.00024, 12);
    expect(fee.feeUsd).toBeNull();
  });
});

describe("ethereumGasPrice", () => {
  beforeEach(() => resetEthereumGasPrice());

  const answer = (result: unknown, ok = true) =>
    ({ ok, json: async () => ({ jsonrpc: "2.0", id: 1, result }) }) as Response;

  it("tries the next endpoint when one fails or answers nonsense, and caches the answer", async () => {
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      if (String(url).includes("publicnode")) throw new Error("down");
      if (String(url).includes("llamarpc")) return answer("not hex");
      return answer("0x77359400"); // 2 gwei
    }) as typeof fetch;
    const first = await ethereumGasPrice(fetchImpl, 1_000);
    expect(first?.wei).toBe(2_000_000_000n);
    expect(first?.source).toBe("cloudflare-eth.com");
    expect(calls).toBe(3);
    const second = await ethereumGasPrice(fetchImpl, 30_000);
    expect(second?.wei).toBe(2_000_000_000n);
    expect(calls).toBe(3);
  });

  it("is null when no endpoint answers, so no comparison is shown", async () => {
    const fetchImpl = (async () => answer(null, false)) as unknown as typeof fetch;
    expect(await ethereumGasPrice(fetchImpl, 1_000)).toBeNull();
  });
});
