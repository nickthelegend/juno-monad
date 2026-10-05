import type { CommandIO } from "@metamask/agent-wallet/plugin";

import type { Tool } from "./agent.js";
import { describeVenue, type Executor, JunoApi } from "./juno.js";
import { trade } from "./trade.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function address(value: unknown): string {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new Error("token must be a 0x address returned by markets or coin");
  return value;
}

/**
 * The five tools `mm juno ask` gives the model. Buys draw on one spend cap
 * per quote token for the whole request; under `dryRun` buy and sell build
 * the trade with Juno and report it, and send nothing.
 */
export function junoTools(context: {
  api?: string;
  wallet: string;
  io: CommandIO;
  executor: () => Promise<Executor>;
  maxSpend: number;
  dryRun: boolean;
}): Tool[] {
  const juno = new JunoApi(context.api || undefined);
  const spent = new Map<string, number>();

  return [
    {
      spec: {
        type: "function",
        function: {
          name: "markets",
          description: "List Juno coins with price, market cap, and where each trades (its curve and how full, or Uniswap v2 / Kuru after graduation).",
          parameters: {
            type: "object",
            properties: {
              sort: { type: "string", enum: ["marketCap", "graduating"], description: "marketCap, or graduating: closest to filling its curve first" },
              limit: { type: "integer", minimum: 1, maximum: 20 },
            },
          },
        },
      },
      run: async (args) => {
        const list = await juno.coins(args.sort === "graduating" ? "graduating" : "marketCap", Math.min(Number(args.limit) || 10, 20));
        return {
          coins: list.coins.map((c) => ({
            address: c.address,
            symbol: c.symbol,
            name: c.name,
            priceUsd: c.priceUsd,
            marketCapUsd: c.marketCap,
            quote: c.quote.symbol,
            curve: { progress: c.curve.progress, graduated: Boolean(c.curve.graduated) },
            venue: c.venue ?? "curve",
          })),
        };
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "coin",
          description: "Look up one Juno coin by token address.",
          parameters: { type: "object", properties: { token: { type: "string" } }, required: ["token"] },
        },
      },
      run: async (args) => {
        const { coin } = await juno.coin(address(args.token));
        return {
          address: coin.address,
          symbol: coin.symbol,
          name: coin.name,
          priceUsd: coin.priceUsd,
          marketCapUsd: coin.marketCap,
          quote: coin.quote.symbol,
          curve: { progress: coin.curve.progress, graduated: Boolean(coin.curve.graduated) },
          venue: coin.venue ?? "curve",
        };
      },
    },
    {
      spec: {
        type: "function",
        function: { name: "portfolio", description: "The Juno coins this wallet holds, with value and P&L.", parameters: { type: "object", properties: {} } },
      },
      run: async () => juno.portfolio(context.wallet),
    },
    {
      spec: {
        type: "function",
        function: {
          name: "buy",
          description: `Buy a Juno coin, spending an amount of its quote token (MON or USDC). At most ${context.maxSpend} of each quote token in this request.`,
          parameters: {
            type: "object",
            properties: { token: { type: "string" }, amount: { type: "number", exclusiveMinimum: 0 } },
            required: ["token", "amount"],
          },
        },
      },
      run: async (args) => {
        const token = address(args.token);
        const amount = Number(args.amount);
        if (!(amount > 0)) throw new Error("amount must be greater than zero");
        const { coin } = await juno.coin(token);
        const symbol = coin.quote.symbol;
        const already = spent.get(symbol) ?? 0;
        if (already + amount > context.maxSpend) {
          throw new Error(`That would spend ${already + amount} ${symbol} in this request; the cap is ${context.maxSpend} ${symbol} (--max-spend).`);
        }
        if (context.dryRun) {
          const built = await juno.buildSwap({ token, side: "buy", owner: context.wallet, amountIn: amount });
          spent.set(symbol, already + amount);
          return { dryRun: true, side: "buy", token, amount, quote: symbol, venue: describeVenue(built.venue), steps: built.steps.map((s) => s.label), expectedOut: built.quote.amountOut ?? null };
        }
        spent.set(symbol, already + amount);
        try {
          return await trade(context.io, await context.executor(), { api: context.api, token, side: "buy", wallet: context.wallet, amountIn: amount });
        } catch (error) {
          spent.set(symbol, already);
          throw error;
        }
      },
    },
    {
      spec: {
        type: "function",
        function: {
          name: "sell",
          description: "Sell a percentage (1–100) of this wallet's holding of a Juno coin. 100 sells all of it.",
          parameters: {
            type: "object",
            properties: { token: { type: "string" }, percent: { type: "number", minimum: 1, maximum: 100 } },
            required: ["token"],
          },
        },
      },
      run: async (args) => {
        const token = address(args.token);
        const percent = args.percent === undefined ? 100 : Number(args.percent);
        if (!(percent > 0 && percent <= 100)) throw new Error("percent is between 1 and 100");
        if (context.dryRun) {
          const built = await juno.buildSwap({ token, side: "sell", owner: context.wallet, sellFraction: percent / 100 });
          return { dryRun: true, side: "sell", token, percent, venue: describeVenue(built.venue), steps: built.steps.map((s) => s.label), expectedOut: built.quote.amountOut ?? null };
        }
        return trade(context.io, await context.executor(), { api: context.api, token, side: "sell", wallet: context.wallet, sellFraction: percent / 100 });
      },
    },
  ];
}
