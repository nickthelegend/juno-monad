import { describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress, maxUint256, parseEther, type Address } from "viem";

import { junoLaunchpadAbi, junoSwapRouterAbi, junoTokenAbi } from "@/lib/juno/abi";
import { evaluatePolicy, tradingPolicy } from "@/lib/juno/privy-policy";

const wallet = getAddress("0x1111111111111111111111111111111111111111");
const stranger = getAddress("0x2222222222222222222222222222222222222222");
const launchpad = getAddress("0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81");
const router = getAddress("0x648c6E84F779Cf20730Db26d49B7B950ca256366");
const usdc = getAddress("0x534b2f3A21130d7a60830c2Df862319e593943A3");
const coin = getAddress("0x14092A529e2e5EB4DECB4a1828f6aFa72e026360");
const now = 1_790_000_000;

const policy = tradingPolicy({
  wallet,
  chainId: 10143,
  launchpad,
  router,
  usdc,
  maxValueWei: parseEther("5"),
  expiresAt: now + 30 * 86_400,
});

const buy = (recipient: Address, value = parseEther("1")) => ({
  chainId: 10143,
  to: launchpad,
  value,
  data: encodeFunctionData({ abi: junoLaunchpadAbi, functionName: "buy", args: [coin, value, 1n, recipient, BigInt(now + 300)] }),
});

describe("the autopilot policy", () => {
  it("is a Privy policy body: version 1.0, ethereum, one ALLOW rule per Juno trade", () => {
    expect(policy.version).toBe("1.0");
    expect(policy.chain_type).toBe("ethereum");
    expect(policy.rules.map((r) => r.name)).toEqual([
      "Buy on a Juno curve",
      "Buy an exact amount on a Juno curve",
      "Sell on a Juno curve",
      "Buy with MON on a graduated coin's pair",
      "Sell for MON on a graduated coin's pair",
      "Swap USDC on a graduated coin's pair",
      "Let Juno's launchpad or router spend USDC",
    ]);
    for (const rule of policy.rules) {
      expect(rule.action).toBe("ALLOW");
      expect(rule.method).toBe("eth_sendTransaction");
      // Every rule pins the chain, the contract, the MON cap and the expiry.
      const fields = rule.conditions.map((c) => `${c.field_source}:${c.field}`);
      expect(fields).toEqual(expect.arrayContaining([
        "ethereum_transaction:chain_id",
        "ethereum_transaction:to",
        "ethereum_transaction:value",
        "system:current_unix_timestamp",
      ]));
    }
    // A calldata condition carries the one ABI fragment it decodes with.
    const calldata = policy.rules[0].conditions.find((c) => c.field_source === "ethereum_calldata");
    expect(calldata).toMatchObject({ field: "buy.recipient", operator: "eq", value: wallet });
    expect(calldata && "abi" in calldata ? calldata.abi.map((f) => f.name) : []).toEqual(["buy"]);
    // JSON-safe: the body Privy receives.
    expect(() => JSON.stringify(policy)).not.toThrow();
  });

  it("allows a curve buy that pays out to the wallet", () => {
    expect(evaluatePolicy(policy, buy(wallet), now)).toEqual({ allowed: true, rule: "Buy on a Juno curve" });
  });

  it("denies a buy that pays out to someone else", () => {
    const verdict = evaluatePolicy(policy, buy(stranger), now);
    expect(verdict).toEqual({ allowed: false, reason: "Autopilot only makes Juno trades that pay out to this wallet." });
  });

  it("denies more MON than the cap", () => {
    const verdict = evaluatePolicy(policy, buy(wallet, parseEther("6")), now);
    expect(verdict).toEqual({ allowed: false, reason: "That sends more MON than autopilot allows per trade (5 MON)." });
  });

  it("denies after it expires", () => {
    const verdict = evaluatePolicy(policy, buy(wallet), now + 31 * 86_400);
    expect(verdict).toEqual({ allowed: false, reason: "Autopilot has expired for this wallet. Turn it on again." });
  });

  it("denies another chain", () => {
    expect(evaluatePolicy(policy, { ...buy(wallet), chainId: 143 }, now).allowed).toBe(false);
  });

  it("denies a transfer of USDC, and an approval to anyone but Juno", () => {
    const transfer = {
      chainId: 10143,
      to: usdc,
      value: 0n,
      data: encodeFunctionData({ abi: junoTokenAbi, functionName: "transfer", args: [stranger, 1_000_000n] }),
    };
    expect(evaluatePolicy(policy, transfer, now).allowed).toBe(false);
    const approveStranger = { ...transfer, data: encodeFunctionData({ abi: junoTokenAbi, functionName: "approve", args: [stranger, maxUint256] }) };
    expect(evaluatePolicy(policy, approveStranger, now).allowed).toBe(false);
    const approveRouter = { ...transfer, data: encodeFunctionData({ abi: junoTokenAbi, functionName: "approve", args: [router, maxUint256] }) };
    expect(evaluatePolicy(policy, approveRouter, now)).toEqual({ allowed: true, rule: "Let Juno's launchpad or router spend USDC" });
  });

  it("allows pair trades through the router that pay the wallet, and nothing to other contracts", () => {
    const pairBuy = {
      chainId: 10143,
      to: router,
      value: parseEther("2"),
      data: encodeFunctionData({ abi: junoSwapRouterAbi, functionName: "buyWithNative", args: [coin, 1n, wallet, BigInt(now + 300)] }),
    };
    expect(evaluatePolicy(policy, pairBuy, now).allowed).toBe(true);
    expect(evaluatePolicy(policy, { ...pairBuy, to: stranger }, now)).toEqual({
      allowed: false,
      reason: "Autopilot only sends to Juno's launchpad, its router and USDC approvals for them.",
    });
    // The curve's buy selector sent to the router decodes as nothing the router rules know.
    expect(evaluatePolicy(policy, { ...buy(wallet), to: router }, now).allowed).toBe(false);
  });

  it("leaves out the pair and USDC rules where those contracts do not exist", () => {
    const bare = tradingPolicy({ wallet, chainId: 10143, launchpad, router: null, usdc: null, maxValueWei: 1n, expiresAt: now + 60 });
    expect(bare.rules).toHaveLength(3);
  });
});
