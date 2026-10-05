/**
 * Juno's Perpl bot: funding carry and a position guard, on Perpl's on-chain
 * perps exchange.
 *
 *   npx tsx scripts/perpl-bot.ts status                 # account, markets, what it would do
 *   npx tsx scripts/perpl-bot.ts deposit 150            # AUSD into Perpl (opens the account)
 *   npx tsx scripts/perpl-bot.ts run --dry-run --once   # decide, sign nothing
 *   npx tsx scripts/perpl-bot.ts run                    # every 30 s until Ctrl-C
 *
 * Options: --config <json> (overrides DEFAULT_CONFIG in lib/juno/perpl-bot.ts),
 * --interval <s>, --once, --dry-run, --state <file>, --halt-file <file>,
 * --mainnet (required to run against chain 143 — real money).
 *
 * Reads Perpl's public API — the live context, each market's funding payments
 * and hourly candles — and the account on chain; `decide` turns that into
 * opens and closes; each is a server-built `execOrder` (immediate-or-cancel,
 * 1% worst price) signed with the bot's own key. A position counts as the
 * bot's only once the chain shows it. State (which positions it opened, the
 * day's realised loss) survives restarts; the halt file is a kill switch that
 * stops it acting at the next tick. Logs are JSON lines.
 *
 * Signs with PERPL_BOT_PRIVATE_KEY or `.juno/perpl-bot.key` (made on first
 * run). Imports only `lib/juno` modules without `server-only`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createWalletClient, http, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import type { ContractCall } from "../lib/juno/launchpad";
import { chain, chainId, isMainnet, rpcEndpoint } from "../lib/juno/network";
import {
  perpAccount,
  perpCloseCall,
  perpDepositCalls,
  perpInfo,
  perpMarketRisk,
  perpMarkets,
  perpOpenCall,
  positionRisk,
} from "../lib/juno/perpl";
import { DEFAULT_CONFIG, decide, type BotAction, type BotConfig, type BotPosition } from "../lib/juno/perpl-bot";
import { arg, describeError, estimate, flag, scriptReader } from "./lib/cli";

type State = { owned: number[]; lossByDay: Record<string, number> };

const KEY_FILE = path.resolve(process.cwd(), ".juno/perpl-bot.key");
const statePath = path.resolve(process.cwd(), arg("state", ".juno/perpl-bot-state.json")!);
const haltPath = path.resolve(process.cwd(), arg("halt-file", ".juno/perpl-bot.halt")!);
const dryRun = flag("dry-run");

function log(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}

function botAccount(): PrivateKeyAccount {
  const fromEnv = process.env.PERPL_BOT_PRIVATE_KEY?.trim();
  if (fromEnv) return privateKeyToAccount((fromEnv.startsWith("0x") ? fromEnv : `0x${fromEnv}`) as Hex);
  if (!existsSync(KEY_FILE)) {
    mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, generatePrivateKey(), { mode: 0o600 });
  }
  return privateKeyToAccount(readFileSync(KEY_FILE, "utf8").trim() as Hex);
}

function loadConfig(): BotConfig {
  const file = arg("config");
  return file ? { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<BotConfig>) } : DEFAULT_CONFIG;
}

function loadState(): State {
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as State;
  } catch {
    return { owned: [], lossByDay: {} };
  }
}

function saveState(state: State) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

const today = () => new Date().toISOString().slice(0, 10);

async function send(account: PrivateKeyAccount, call: ContractCall): Promise<Hex> {
  const gas = await estimate(account.address, call);
  const wallet = createWalletClient({ account, chain: chain(), transport: http(rpcEndpoint(), { retryCount: 2, retryDelay: 500 }) });
  const fees = await scriptReader().estimateFeesPerGas();
  const hash = await wallet.sendTransaction({
    account,
    chain: chain(),
    to: call.to,
    data: call.data,
    value: call.value,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  });
  const receipt = await scriptReader().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error(`${call.label} reverted in block ${receipt.blockNumber} (${hash})`);
  log("tx", { label: call.label, hash, block: Number(receipt.blockNumber) });
  return hash;
}

/** One look at the world: markets, the account, and which marks Perpl would trade against. */
async function observe(owner: Address, state: State, config: BotConfig) {
  // Risk for the markets the bot watches, plus any it holds a position in (the guard covers those too).
  const held = (await perpAccount(owner)).positions.map((p) => p.symbol);
  const symbols = config.markets.length ? [...new Set([...config.markets, ...held])] : undefined;
  const [markets, account, context] = await Promise.all([perpMarketRisk(Date.now(), symbols), perpAccount(owner), perpMarkets()]);
  const intervals = new Map(context.map((m) => [m.id, m.fundingIntervalSec]));
  const risks = positionRisk(account.positions, markets, intervals);
  const positions: BotPosition[] = risks.map((risk) => {
    const held = account.positions.find((p) => p.perpId === risk.perpId)!;
    return { ...risk, collateral: held.collateral, pnl: held.pnl, ownedByBot: state.owned.includes(risk.perpId) };
  });
  const now = Math.floor(Date.now() / 1000);
  const staleMarkets = new Set<number>();
  const watched = markets.filter((m) => config.markets.length === 0 || config.markets.includes(m.symbol));
  await Promise.all(
    watched.map(async (m) => {
      const info = await perpInfo(m.id).catch(() => null);
      if (!info || now - info.markTimestamp >= info.maxAgeSec) staleMarkets.add(m.id);
    }),
  );
  return { markets, account, positions, staleMarkets };
}

async function act(account: PrivateKeyAccount, action: BotAction, world: Awaited<ReturnType<typeof observe>>, state: State) {
  if (action.kind === "hold") return;
  if (dryRun) return log("would", { action });
  try {
    if (action.kind === "open") {
      const market = world.markets.find((m) => m.id === action.perpId);
      const ctx = (await perpMarkets()).find((m) => m.id === action.perpId);
      const { call } = await perpOpenCall({
        perpId: action.perpId,
        side: action.side,
        collateral: action.collateral,
        leverage: action.leverage,
        slippageBps: 100,
        takerFee: ctx?.takerFee,
      });
      await send(account, call);
      // Immediate-or-cancel can fill nothing; only a position the chain shows is the bot's.
      const after = await perpAccount(account.address);
      if (after.positions.some((p) => p.perpId === action.perpId)) {
        if (!state.owned.includes(action.perpId)) state.owned.push(action.perpId);
        log("opened", { symbol: action.symbol, side: action.side, mark: market?.mark, reason: action.reason });
      } else {
        log("unfilled", { symbol: action.symbol, reason: "nothing filled within 1% of the mark" });
      }
    } else {
      const held = world.account.positions.find((p) => p.perpId === action.perpId);
      if (!held) return;
      await send(account, await perpCloseCall({ perpId: action.perpId, position: held, slippageBps: 100 }));
      state.owned = state.owned.filter((id) => id !== action.perpId);
      // The P&L the decision saw is what the close realises, to within the fill.
      if (held.pnl < 0) state.lossByDay[today()] = (state.lossByDay[today()] ?? 0) - held.pnl;
      log("closed", { symbol: action.symbol, pnl: held.pnl, reason: action.reason });
    }
  } catch (error) {
    log("error", { action, message: describeError(error) });
  } finally {
    saveState(state);
  }
}

async function tick(account: PrivateKeyAccount, config: BotConfig, state: State) {
  const world = await observe(account.address, state, config);
  // A position the bot opened that is gone was closed elsewhere (by hand, or liquidated).
  state.owned = state.owned.filter((id) => world.account.positions.some((p) => p.perpId === id));
  const actions = decide(
    {
      markets: world.markets,
      positions: world.positions,
      freeCollateral: world.account.balance,
      lossToday: state.lossByDay[today()] ?? 0,
      halted: existsSync(haltPath),
      staleMarkets: world.staleMarkets,
    },
    config,
  );
  log("tick", {
    free: world.account.balance,
    positions: world.positions.map((p) => ({ symbol: p.symbol, side: p.side, pnl: p.pnl, liq: p.liquidationDistance, bot: p.ownedByBot })),
    actions: actions.map((a) => (a.kind === "hold" ? `hold: ${a.reason}` : `${a.kind} ${a.symbol}${a.kind === "open" ? ` ${a.side}` : ""}: ${a.reason}`)),
  });
  for (const action of actions) await act(account, action, world, state);
}

async function main() {
  const command = process.argv[2] ?? "status";
  if (isMainnet() && !flag("mainnet")) throw new Error("This is Monad mainnet — real money. Pass --mainnet to run here.");
  const account = botAccount();
  const config = loadConfig();
  log("start", { command, bot: account.address, chainId: chainId(), rpc: rpcEndpoint(), dryRun, config });

  if (command === "deposit") {
    const amount = Number(process.argv[3]);
    if (!(amount > 0)) throw new Error("deposit <amount in AUSD>");
    const before = await perpAccount(account.address);
    for (const call of await perpDepositCalls(account.address, amount, before.accountId !== null)) await send(account, call);
    const after = await perpAccount(account.address);
    return log("deposited", { accountId: after.accountId, free: after.balance, wallet: after.walletAusd });
  }

  const state = loadState();
  if (command === "status") {
    const world = await observe(account.address, state, config);
    return log("status", {
      accountId: world.account.accountId,
      free: world.account.balance,
      walletAusd: world.account.walletAusd,
      positions: world.positions,
      markets: world.markets.map((m) => ({ symbol: m.symbol, fundingAnnualized: m.fundingAnnualized, volatility: m.volatility, stale: world.staleMarkets.has(m.id) })),
      wouldDo: decide({ markets: world.markets, positions: world.positions, freeCollateral: world.account.balance, lossToday: state.lossByDay[today()] ?? 0, halted: existsSync(haltPath), staleMarkets: world.staleMarkets }, config),
    });
  }

  if (command !== "run") throw new Error(`Unknown command ${command}: status | deposit <amount> | run`);
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    log("stopping", { reason: "SIGINT: finishing this tick" });
  });
  const interval = Number(arg("interval", "30")) * 1000;
  do {
    try {
      await tick(account, config, state);
    } catch (error) {
      log("error", { message: describeError(error) });
    }
    if (flag("once") || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  } while (!stopping);
  saveState(state);
  log("stopped");
}

main().catch((error) => {
  log("fatal", { message: describeError(error) });
  process.exit(1);
});
