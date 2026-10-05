import type { CommandIO } from "@metamask/agent-wallet/plugin";

import { describeVenue, type Executor, JunoApi, type Landed, submitSteps, txUrl } from "./juno.js";

export type TradeResult = {
  side: "buy" | "sell";
  token: string;
  wallet: string;
  venue: string;
  quoteSymbol: string;
  expectedOut: number | null;
  minimumOut: number | null;
  transactions: Array<Landed & { url: string }>;
};

/**
 * One Juno trade through the Agent Wallet: Juno builds the steps for this
 * wallet, the wallet's executor signs and sends each (its policy, simulation
 * and 2FA apply), in order.
 */
export async function trade(
  io: CommandIO,
  executor: Executor,
  input: { api?: string; token: string; side: "buy" | "sell"; wallet: string; amountIn?: number; sellFraction?: number; slippageBps?: number },
): Promise<TradeResult> {
  const juno = new JunoApi(input.api || undefined);
  const config = await juno.config();
  io.progress("Asking Juno to build the trade…");
  const built = await juno.buildSwap({
    token: input.token,
    side: input.side,
    owner: input.wallet,
    amountIn: input.amountIn,
    sellFraction: input.sellFraction,
    slippageBps: input.slippageBps,
  });
  if (built.steps.length === 0) throw new Error("Juno built nothing to send.");
  for (const step of built.steps) {
    if (step.request.chainId !== config.chainId) throw new Error(`Juno built for chain ${step.request.chainId}, not ${config.chainId}.`);
    if (step.request.from.toLowerCase() !== input.wallet.toLowerCase()) throw new Error("Juno built this for a different wallet.");
  }
  const what =
    input.side === "buy"
      ? `buy ${input.amountIn} ${built.quoteSymbol} of ${input.token} ${describeVenue(built.venue)}`
      : `sell ${Math.round((input.sellFraction ?? 1) * 100)}% of ${input.token} ${describeVenue(built.venue)}`;
  io.progress(`Sending through the Agent Wallet: ${what}`);
  const landed = await submitSteps(executor, built.steps, { intent: `Juno: ${what}`, signal: io.signal });
  return {
    side: input.side,
    token: input.token,
    wallet: input.wallet,
    venue: built.venue,
    quoteSymbol: built.quoteSymbol,
    expectedOut: built.quote.amountOut ?? null,
    minimumOut: built.quote.minimumAmountOut ?? null,
    transactions: landed.map((l) => ({ ...l, url: txUrl(config.explorer, l.hash) })),
  };
}
