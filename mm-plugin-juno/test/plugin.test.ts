import { readFileSync } from "node:fs";

import { PluginManifestSchema } from "@metamask/agent-wallet/plugin";
import { describe, expect, it } from "vitest";

import { coinLine, type Executor, JunoApi, JunoError, PartialSubmitError, type Step, submitSteps, txUrl } from "../src/lib/juno";
import { activeAddress } from "../src/lib/wallet";

const WALLET = "0xB5a4c292d73Ba96cB5126b0A81039e1cbc945Fba";
const step = (label: string, to = "0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81"): Step => ({
  label,
  request: { chainId: 10143, from: WALLET, to, data: "0x1234", value: "0x0" },
});

describe("the manifest", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  it("passes MetaMask's own schema", () => {
    expect(PluginManifestSchema.safeParse(pkg.mm).success).toBe(true);
  });

  it("asks for wallet-submit only on the commands that trade, and nothing plugin-wide", () => {
    expect(pkg.mm.capabilities).toEqual([]);
    const caps = Object.fromEntries(pkg.mm.commands.map((c: { id: string; capabilities: string[] }) => [c.id, c.capabilities]));
    expect(caps["juno:markets"]).toEqual([]);
    expect(caps["juno:coin"]).toEqual([]);
    expect(caps["juno:portfolio"]).toEqual(["wallet-read"]);
    expect(caps["juno:buy"]).toContain("wallet-submit");
    expect(caps["juno:sell"]).toContain("wallet-submit");
  });
});

describe("submitSteps", () => {
  it("sends each step in order, with Juno's intent, and returns the hashes", async () => {
    const seen: Parameters<Executor>[0][] = [];
    const executor: Executor = async (request) => {
      seen.push(request);
      return { kind: "transaction", hash: `0x${String(seen.length).padStart(64, "0")}`, status: "confirmed" };
    };
    const landed = await submitSteps(executor, [step("Allowing Juno to spend USDC"), step("Buying")], { intent: "Juno: buy 5 USDC of 0xabc" });
    expect(landed.map((l) => l.label)).toEqual(["Allowing Juno to spend USDC", "Buying"]);
    expect(seen.map((r) => r.kind)).toEqual(["transaction", "transaction"]);
    expect(seen[0]).toMatchObject({ chainId: 10143, transaction: { to: "0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81", data: "0x1234", value: "0x0" } });
    expect(seen[1].intent).toBe("Juno: buy 5 USDC of 0xabc (step 2 of 2: Buying)");
    // `from` is the wallet's to decide; Juno does not send it.
    expect("from" in seen[0].transaction).toBe(false);
  });

  it("a one-step trade carries the intent as it is", async () => {
    let intent = "";
    await submitSteps(async (r) => ((intent = r.intent ?? ""), { kind: "transaction", hash: "0x1" }), [step("Buying")], { intent: "Juno: buy" });
    expect(intent).toBe("Juno: buy");
  });

  it("stops at a step the wallet refuses, and says what already landed", async () => {
    let calls = 0;
    const executor: Executor = async () => {
      calls += 1;
      return calls === 1 ? { kind: "transaction", hash: "0xaa", status: "confirmed" } : { kind: "transaction", status: "failed", failureDescription: "Guard mode blocked it" };
    };
    const error = await submitSteps(executor, [step("Allowing"), step("Buying"), step("Never sent")], { intent: "x" }).catch((e) => e);
    expect(error).toBeInstanceOf(PartialSubmitError);
    expect(error.message).toBe("Allowing went through, but buying did not: Guard mode blocked it");
    expect((error as PartialSubmitError).landed).toEqual([{ label: "Allowing", hash: "0xaa", status: "confirmed" }]);
    expect(calls).toBe(2);
  });

  it("a first step that fails is a plain error", async () => {
    await expect(submitSteps(async () => ({ kind: "transaction", status: "rejected" }), [step("Buying")], { intent: "x" })).rejects.toThrow(
      "Buying did not go through: the wallet answered rejected",
    );
  });
});

describe("JunoApi", () => {
  it("says Juno's own sentence when it refuses", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "Coin not found" }), { status: 404 })) as typeof fetch;
    const error = await new JunoApi("https://juno.example", fetchImpl).coin("0x1").catch((e) => e);
    expect(error).toBeInstanceOf(JunoError);
    expect(error.message).toBe("Coin not found");
    expect(error.status).toBe(404);
  });

  it("posts the swap Juno should build, for this wallet", async () => {
    let body: unknown;
    let url = "";
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ steps: [], quote: {}, quoteSymbol: "MON", venue: "curve" }), { status: 200 });
    }) as typeof fetch;
    await new JunoApi("https://juno.example", fetchImpl).buildSwap({ token: "0xabc", side: "sell", owner: WALLET, sellFraction: 0.5 });
    expect(url).toBe("https://juno.example/api/juno/tx/swap");
    expect(body).toEqual({ amountIn: 0, token: "0xabc", side: "sell", owner: WALLET, sellFraction: 0.5 });
  });
});

describe("activeAddress", () => {
  const a = "0x1111111111111111111111111111111111111111";
  const b = "0x2222222222222222222222222222222222222222";
  it("prefers the selected wallet", () => {
    expect(activeAddress({ remoteWallets: [{ id: "w1", address: a }, { id: "w2", address: b }], selectedWallet: { ref: "w2" } })).toBe(b);
    expect(activeAddress({ byokWallets: [{ address: a }], selectedWallet: { ref: { address: b } } })).toBe(b);
  });
  it("falls back to the first EVM wallet, and to null", () => {
    expect(activeAddress({ byokWallets: [{ address: "not-an-address" }, { address: a }] })).toBe(a);
    expect(activeAddress({})).toBeNull();
  });
});

describe("formatting", () => {
  it("a coin line and a transaction link", () => {
    const line = coinLine({
      address: "0x975AfA7295D078e2D834124a9EA441BbcdBA9b48",
      name: "Autopilot Test",
      symbol: "AUTOP",
      priceUsd: 0.0063,
      marketCap: 1004,
      marketCapCurrency: "USD",
      marketCapChangePct: 2.5,
      quote: { symbol: "MON", native: true },
      curve: { progress: 0.04, graduated: false },
      curvePreset: "content",
      holders: 3,
    });
    expect(line).toBe("$AUTOP  Autopilot Test  $0.00630  mcap $1.00k +2.5%  curve 4%  0x975AfA7295D078e2D834124a9EA441BbcdBA9b48");
    expect(txUrl("https://testnet.monadvision.com/", "0xab")).toBe("https://testnet.monadvision.com/tx/0xab");
  });
});
