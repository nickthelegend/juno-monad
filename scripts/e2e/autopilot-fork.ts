/**
 * Autopilot end to end on a local fork of Monad testnet, in fixture mode
 * (no Privy keys): the API's real routes, real transactions on the fork.
 *
 *   JUNO_API_URL=http://localhost:3150 FORK_RPC=http://127.0.0.1:8555 \
 *     npx tsx scripts/e2e/autopilot-fork.ts <curve coin> <graduated coin>
 *
 * The API must run with JUNO_AUTOPILOT_FIXTURE=1 against the fork. Refuses to
 * run when the API is not on a local fork. Checks, in order:
 *
 *  1. off by default; a plan on each coin is created and shows as due;
 *  2. start (signed by the wallet) → active, with the policy's rules listed;
 *  3. the runner buys both due plans (curve `buy`, pair `buyWithNative`); the
 *     wallet's token balances rise on chain; each plan's contribution moves;
 *  4. a second runner pass buys nothing (not due), and two passes at once
 *     cannot buy the same due plan twice;
 *  5. a trade the person asks for, sent through autopilot, lands;
 *  6. the policy refuses: a payout to another address, more MON than the cap,
 *     a call to a contract outside Juno (each a 403 with a sentence);
 *  7. stop → the runner skips the wallet and a send is refused.
 */

import { createPublicClient, encodeFunctionData, erc20Abi, getAddress, http, parseEther, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { junoLaunchpadAbi } from "../../lib/juno/abi";

const API = process.env.JUNO_API_URL ?? "http://localhost:3150";
const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8555";
const [curveCoin, pairCoin] = process.argv.slice(2).map((a) => getAddress(a));
if (!curveCoin || !pairCoin) throw new Error("usage: autopilot-fork.ts <curve coin> <graduated coin>");

const chain = createPublicClient({ transport: http(RPC) });
const account = privateKeyToAccount(generatePrivateKey());
const wallet = account.address;
let failures = 0;

function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : `  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

async function api<T>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...init?.headers },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function signed(action: "start" | "stop" | "send") {
  const issuedAt = new Date().toISOString();
  const signature = await account.signMessage({ message: `Juno autopilot: ${action}\nWallet: ${wallet}\nIssued: ${issuedAt}` });
  return { issuedAt, signature };
}

const balance = (token: Address) => chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] });

type Status = { mode: string; status: string; allows: string[]; runs: Array<{ kind: string; label: string; hash: string | null; error: string | null; via: string }> };
type Plan = { id: string; token: string; contributed: number; fills: number; due: boolean };

async function main() {
  const config = (await api<{ localFork: boolean; autopilot: { mode: string } }>("/api/juno/config")).body;
  if (!config.localFork || config.autopilot.mode !== "fixture") throw new Error("Run this against an API on a local fork with JUNO_AUTOPILOT_FIXTURE=1.");
  await chain.request({ method: "anvil_setBalance" as never, params: [wallet, toHex(parseEther("50"))] as never });
  console.log(`wallet ${wallet} (fresh, 50 fork MON)\n`);

  // 1
  check("off by default", (await api<Status>(`/api/juno/autopilot?wallet=${wallet}`)).body.status === "off");
  for (const [token, amount] of [[curveCoin, 0.5], [pairCoin, 1]] as const) {
    const made = await api<{ id: string }>("/api/juno/plans", { body: { wallet, token, amount, cadence: "daily" } });
    check(`plan created on ${token.slice(0, 10)}`, made.status === 201, made.body);
  }
  const before = (await api<{ plans: Plan[] }>(`/api/juno/plans?wallet=${wallet}`)).body.plans;
  check("both plans due", before.length === 2 && before.every((p) => p.due));

  // 2
  const started = await api<Status>("/api/juno/autopilot", { body: { action: "start", wallet, ...(await signed("start")) } });
  check("start → active", started.status === 200 && started.body.status === "active", started.body.status);
  check("policy lists Juno trades only", started.body.allows.length >= 3 && started.body.allows.every((r) => /Juno|pair|USDC/.test(r)), started.body.allows);
  const forged = await api<{ error: string }>("/api/juno/autopilot", {
    body: { action: "start", wallet, issuedAt: new Date().toISOString(), signature: (await signed("stop")).signature },
  });
  check("start signed for another action is refused", forged.status === 400, forged.body.error);

  // 3
  const [curveBefore, pairBefore] = await Promise.all([balance(curveCoin), balance(pairCoin)]);
  const [first, second] = await Promise.all([
    api<{ runs: Array<{ wallet: string; hash: string | null; error: string | null; label: string }> }>("/api/juno/autopilot/run", { body: {} }),
    api<{ runs: Array<{ wallet: string; hash: string | null; error: string | null }> }>("/api/juno/autopilot/run", { body: {} }),
  ]);
  const mine = [...first.body.runs, ...second.body.runs].filter((r) => getAddress(r.wallet) === wallet);
  check("runner bought each due plan exactly once (two runners at once)", mine.length === 2 && mine.every((r) => r.hash && !r.error), mine);
  for (const run of mine) {
    const receipt = await chain.getTransactionReceipt({ hash: run.hash as Hex });
    check(`plan buy ${run.hash?.slice(0, 12)} on chain`, receipt.status === "success", `block ${receipt.blockNumber}`);
  }
  const [curveAfter, pairAfter] = await Promise.all([balance(curveCoin), balance(pairCoin)]);
  check("curve coin balance rose", curveAfter > curveBefore, `${curveBefore} → ${curveAfter}`);
  check("graduated coin balance rose", pairAfter > pairBefore, `${pairBefore} → ${pairAfter}`);
  const after = (await api<{ plans: Plan[] }>(`/api/juno/plans?wallet=${wallet}`)).body.plans;
  check("contributions recorded, plans no longer due", after.every((p) => p.fills === 1 && p.contributed > 0 && !p.due), after.map((p) => [p.fills, p.contributed, p.due]));

  // 4
  const again = (await api<{ runs: Array<{ wallet: string }> }>("/api/juno/autopilot/run", { body: {} })).body.runs.filter((r) => getAddress(r.wallet) === wallet);
  check("a second pass buys nothing", again.length === 0);

  // 5
  const built = (await api<{ steps: Array<{ label: string; request: { to: string; data: string; value: string } }> }>("/api/juno/tx/swap", {
    body: { token: curveCoin, side: "buy", amountIn: 0.2, owner: wallet },
  })).body;
  const steps = built.steps.map((s) => ({ to: s.request.to, data: s.request.data, value: s.request.value, label: s.label }));
  const sent = await api<{ results: Array<{ hash: string; trades: number; via: string; sponsored: boolean }> }>("/api/juno/autopilot/send", {
    body: { wallet, steps, ...(await signed("send")) },
  });
  check("a trade sent through autopilot lands", sent.status === 200 && sent.body.results?.[0]?.trades >= 1, sent.body);

  // 6
  const stranger = privateKeyToAccount(generatePrivateKey()).address;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const refusals: Array<[string, { to: string; data: string; value: string }]> = [
    ["pays out to another address", { to: built.steps[0].request.to, value: toHex(parseEther("0.1")), data: encodeFunctionData({ abi: junoLaunchpadAbi, functionName: "buy", args: [curveCoin, parseEther("0.1"), 1n, stranger, deadline] }) }],
    ["more MON than the cap", { to: built.steps[0].request.to, value: toHex(parseEther("6")), data: encodeFunctionData({ abi: junoLaunchpadAbi, functionName: "buy", args: [curveCoin, parseEther("6"), 1n, wallet, deadline] }) }],
    ["a transfer out of the wallet", { to: curveCoin, value: "0x0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [stranger, 1n] }) }],
  ];
  for (const [name, step] of refusals) {
    const refused = await api<{ error: string }>("/api/juno/autopilot/send", { body: { wallet, steps: [{ ...step, label: name }], ...(await signed("send")) } });
    check(`policy refuses ${name}`, refused.status === 403, refused.body.error);
  }

  // 7
  const stopped = await api<Status>("/api/juno/autopilot", { body: { action: "stop", wallet, ...(await signed("stop")) } });
  check("stop → off", stopped.body.status === "off", stopped.body.status);
  const afterStop = await api<{ error: string }>("/api/juno/autopilot/send", { body: { wallet, steps, ...(await signed("send")) } });
  check("a send after stop is refused", afterStop.status === 409, afterStop.body.error);
  const status = (await api<Status>(`/api/juno/autopilot?wallet=${wallet}`)).body;
  check("runs are kept for the record", status.runs.filter((r) => r.hash).length >= 3, status.runs.map((r) => `${r.kind}: ${r.label}`));

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
