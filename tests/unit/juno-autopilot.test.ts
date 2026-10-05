import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, getAddress, parseEther } from "viem";

import { junoLaunchpadAbi } from "@/lib/juno/abi";

/**
 * Autopilot's server logic (lib/juno/autopilot.ts) with test doubles for its
 * edges: Privy's client, Mongo, Postgres plans and the trade builder. These
 * tests check what Juno does around Privy:
 * - enrolment writes a policy, and confirmation checks the signer;
 * - the runner buys each due plan once, under two runners at once, and
 *   records it;
 * - the policy refuses before Privy is asked;
 * - a session that is not the wallet's is refused;
 * - with no signer configured, autopilot is off.
 * Live Privy sends go to Monad testnet and are covered there.
 */

const LAUNCHPAD = getAddress("0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81");
const ROUTER = getAddress("0x648c6E84F779Cf20730Db26d49B7B950ca256366");
const WALLET = getAddress("0x1111111111111111111111111111111111111111");
const STRANGER = getAddress("0x2222222222222222222222222222222222222222");
const COIN = getAddress("0x14092A529e2e5EB4DECB4a1828f6aFa72e026360");

const h = vi.hoisted(() => {
  type Doc = Record<string, unknown>;
  const matches = (doc: Doc, query: Doc): boolean =>
    Object.entries(query).every(([key, want]) => {
      if (key === "$or") return (want as Doc[]).some((q) => matches(doc, q));
      const have = doc[key];
      if (want && typeof want === "object" && !(want instanceof Date)) {
        const ops = want as Record<string, unknown>;
        if ("$exists" in ops) return (have !== undefined) === ops.$exists;
        if ("$gt" in ops) return have !== undefined && have !== null && (have as number) > (ops.$gt as number);
        if ("$lt" in ops) return have !== undefined && have !== null && (have as number) < (ops.$lt as number);
        if ("$ne" in ops) return have !== ops.$ne;
      }
      return want instanceof Date && have instanceof Date ? want.getTime() === have.getTime() : have === want;
    });
  const collections = new Map<string, Doc[]>();
  let ids = 0;
  const collection = (name: string) => {
    if (!collections.has(name)) collections.set(name, []);
    const rows = collections.get(name)!;
    const cursor = (found: Doc[]) => {
      const c = { sort: () => c, limit: () => c, toArray: async () => found };
      return c;
    };
    return {
      createIndex: async () => undefined,
      findOne: async (q: Doc) => rows.find((d) => matches(d, q)) ?? null,
      find: (q: Doc) => cursor(rows.filter((d) => matches(d, q))),
      insertOne: async (doc: Doc) => {
        if (name === "autopilot_runs" && typeof doc.claim === "string" && rows.some((d) => d.claim === doc.claim)) {
          throw new Error("E11000 duplicate key");
        }
        const _id = ++ids;
        rows.push({ ...doc, _id });
        return { insertedId: _id };
      },
      updateOne: async (q: Doc, update: { $set: Doc }, options?: { upsert?: boolean }) => {
        const doc = rows.find((d) => matches(d, q));
        if (doc) Object.assign(doc, update.$set);
        else if (options?.upsert) rows.push({ ...q, ...update.$set, _id: ++ids });
      },
      findOneAndUpdate: async (q: Doc, update: { $set: Doc }) => {
        const doc = rows.find((d) => matches(d, q));
        if (!doc) return null;
        Object.assign(doc, update.$set);
        return doc;
      },
    };
  };
  const privyCalls = { policies: [] as unknown[], sends: [] as Array<{ walletId: string; input: Record<string, unknown> }> };
  const privySigners = { list: [] as Array<{ signer_id: string; override_policy_ids?: string[] }> };
  const sessions = new Map<string, string>([["token-owner", "user-1"], ["token-other", "user-2"]]);
  const plansDue: Array<{ id: string; token: string; amount: number; due: boolean; lastFilledAt: string | null; createdAt: string }> = [];
  const contributions: Array<[string, number]> = [];
  return { collections, collection, privyCalls, privySigners, sessions, plansDue, contributions };
});

vi.mock("@/lib/juno/social", () => ({ db: async () => ({ collection: h.collection }) }));
vi.mock("@/lib/juno/network", () => ({
  chainId: () => 10143,
  launchpadAddress: () => LAUNCHPAD,
  swapRouterAddress: () => ROUTER,
  networkKey: () => "monad-testnet",
}));
vi.mock("@/lib/juno/launchpad", () => ({ USDC: { address: getAddress("0x534b2f3A21130d7a60830c2Df862319e593943A3") } }));
vi.mock("@/lib/juno/social-graph", () => ({
  plans: async () => h.plansDue.map((p) => ({ ...p })),
  recordContribution: async (id: string, amount: number) => {
    h.contributions.push([id, amount]);
    const plan = h.plansDue.find((p) => p.id === id)!;
    plan.due = false;
    plan.lastFilledAt = new Date().toISOString();
    return null;
  },
}));
vi.mock("@/lib/juno/tx", () => ({
  explainFailure: (error: unknown) => String(error),
  settleSent: async (hash: string) => ({ hash, blockNumber: 1, from: WALLET, trades: 1, confirmedInMs: 5 }),
  buildSwap: async ({ token, amountIn, owner }: { token: string; amountIn: number; owner: string }) => ({
    steps: [
      {
        label: "Buying",
        request: {
          to: LAUNCHPAD,
          value: `0x${parseEther(String(amountIn)).toString(16)}`,
          data: encodeFunctionData({ abi: junoLaunchpadAbi, functionName: "buy", args: [token as `0x${string}`, parseEther(String(amountIn)), 1n, owner as `0x${string}`, 2_000_000_000n] }),
        },
      },
    ],
    quoteSymbol: "MON",
    venue: "curve",
  }),
}));
vi.mock("@/lib/juno/privy", () => ({
  privyConfigured: () => true,
  privy: () => ({
    utils: () => ({
      auth: () => ({
        verifyAccessToken: async (token: string) => {
          const user = h.sessions.get(token);
          if (!user) throw new Error("bad token");
          return { user_id: user };
        },
      }),
    }),
    users: () => ({
      _get: async (userId: string) => ({
        linked_accounts:
          userId === "user-1"
            ? [{ type: "wallet", connector_type: "embedded", address: WALLET, id: "wallet-1" }]
            : [{ type: "wallet", connector_type: "embedded", address: STRANGER, id: "wallet-2" }],
      }),
    }),
    policies: () => ({
      create: async (policy: unknown) => (h.privyCalls.policies.push(policy), { id: "policy-1" }),
      delete: async () => ({ success: true }),
    }),
    wallets: () => ({
      get: async () => ({ additional_signers: h.privySigners.list }),
      ethereum: () => ({
        sendTransaction: async (walletId: string, input: Record<string, unknown>) => {
          h.privyCalls.sends.push({ walletId, input });
          return { hash: `0x${String(h.privyCalls.sends.length).padStart(64, "0")}`, caip2: "eip155:10143" };
        },
      }),
    }),
  }),
}));

async function load() {
  return import("@/lib/juno/autopilot");
}

beforeEach(() => {
  h.collections.clear();
  h.privyCalls.policies.length = 0;
  h.privyCalls.sends.length = 0;
  h.privySigners.list = [];
  h.contributions.length = 0;
  h.plansDue.length = 0;
  vi.stubEnv("PRIVY_SIGNER_ID", "quorum-1");
  vi.stubEnv("PRIVY_AUTHORIZATION_KEY", "auth-key");
  vi.stubEnv("PRIVY_SPONSOR_GAS", "1");
});
afterEach(() => vi.unstubAllEnvs());

async function enrol() {
  const autopilot = await load();
  const started = await autopilot.startAutopilot({ wallet: WALLET, accessToken: "token-owner" });
  h.privySigners.list = [{ signer_id: "quorum-1", override_policy_ids: ["policy-1"] }];
  await autopilot.confirmAutopilot({ wallet: WALLET, accessToken: "token-owner" });
  return { autopilot, started };
}

describe("autopilot", () => {
  it("is off, and says so, without a Privy signer", async () => {
    vi.stubEnv("PRIVY_SIGNER_ID", "");
    const autopilot = await load();
    expect(autopilot.autopilotConfig().mode).toBe("off");
    await expect(autopilot.startAutopilot({ wallet: WALLET, accessToken: "token-owner" })).rejects.toThrow("Autopilot is not set up on this server.");
  });

  it("writes this wallet's policy in Privy, waits for the signer, then turns on", async () => {
    const autopilot = await load();
    const started = await autopilot.startAutopilot({ wallet: WALLET, accessToken: "token-owner" });
    expect(started).toMatchObject({ status: "pending", policyId: "policy-1", signerId: "quorum-1", sponsor: true });
    expect(h.privyCalls.policies).toHaveLength(1);
    // The signer is not on the wallet yet: confirming says so.
    await expect(autopilot.confirmAutopilot({ wallet: WALLET, accessToken: "token-owner" })).rejects.toThrow("does not list Juno as a signer");
    h.privySigners.list = [{ signer_id: "quorum-1", override_policy_ids: ["policy-1"] }];
    expect((await autopilot.confirmAutopilot({ wallet: WALLET, accessToken: "token-owner" })).status).toBe("active");
  });

  it("refuses a Privy session whose user does not own the wallet", async () => {
    const autopilot = await load();
    await expect(autopilot.startAutopilot({ wallet: WALLET, accessToken: "token-other" })).rejects.toThrow("not it");
    await expect(autopilot.startAutopilot({ wallet: WALLET })).rejects.toThrow("Sign in with Privy first.");
  });

  it("buys each due plan once through Privy, sponsored and signed by Juno's key, with two runners at once", async () => {
    const { autopilot } = await enrol();
    h.plansDue.push(
      { id: "plan-a", token: COIN, amount: 1, due: true, lastFilledAt: null, createdAt: "2026-10-01T00:00:00Z" },
      { id: "plan-b", token: COIN, amount: 0.5, due: true, lastFilledAt: null, createdAt: "2026-10-02T00:00:00Z" },
    );
    const [first, second] = await Promise.all([autopilot.runDuePlans(), autopilot.runDuePlans()]);
    const bought = [...first, ...second];
    expect(bought.map((r) => r.planId).sort()).toEqual(["plan-a", "plan-b"]);
    expect(bought.every((r) => r.hash && !r.error && r.sponsored)).toBe(true);
    expect(h.privyCalls.sends).toHaveLength(2);
    expect(h.privyCalls.sends[0]).toMatchObject({
      walletId: "wallet-1",
      input: { caip2: "eip155:10143", sponsor: true, authorization_context: { authorization_private_keys: ["auth-key"] } },
    });
    expect(h.contributions.sort()).toEqual([["plan-a", 1], ["plan-b", 0.5]]);
    // Nothing is due any more: a third pass buys nothing.
    expect(await autopilot.runDuePlans()).toEqual([]);
  });

  it("refuses a step outside the policy before asking Privy, and a session that is not the enrolled user's", async () => {
    const { autopilot } = await enrol();
    const payout = (to: `0x${string}`) =>
      encodeFunctionData({ abi: junoLaunchpadAbi, functionName: "buy", args: [COIN, parseEther("1"), 1n, to, 2_000_000_000n] });
    await expect(
      autopilot.sendForWallet({ wallet: WALLET, accessToken: "token-owner", steps: [{ to: LAUNCHPAD, data: payout(STRANGER), value: "0x0", label: "Buying" }] }),
    ).rejects.toThrow("Autopilot only makes Juno trades that pay out to this wallet.");
    expect(h.privyCalls.sends).toHaveLength(0);

    const sent = await autopilot.sendForWallet({ wallet: WALLET, accessToken: "token-owner", steps: [{ to: LAUNCHPAD, data: payout(WALLET), value: "0x0", label: "Buying" }] });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ via: "privy", sponsored: true });

    h.sessions.set("token-intruder", "user-1b");
    await expect(
      autopilot.sendForWallet({ wallet: WALLET, accessToken: "token-other", steps: [{ to: LAUNCHPAD, data: payout(WALLET), value: "0x0", label: "Buying" }] }),
    ).rejects.toThrow();
  });

  it("stops: the status goes off and sends are refused", async () => {
    const { autopilot } = await enrol();
    expect((await autopilot.stopAutopilot({ wallet: WALLET, accessToken: "token-owner" })).status).toBe("off");
    await expect(
      autopilot.sendForWallet({ wallet: WALLET, accessToken: "token-owner", steps: [{ to: LAUNCHPAD, data: "0x", value: "0x0", label: "x" }] }),
    ).rejects.toThrow("Autopilot is off for this wallet.");
  });
});
