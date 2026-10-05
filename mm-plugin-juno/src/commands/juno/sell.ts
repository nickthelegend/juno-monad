import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";

import { apiInput, tokenInput } from "../../lib/inputs.js";
import type { Executor } from "../../lib/juno.js";
import { trade, type TradeResult } from "../../lib/trade.js";
import { activeAddress } from "../../lib/wallet.js";

const inputs = {
  token: tokenInput,
  percent: {
    type: InputFieldType.Text,
    flag: "percent",
    message: "How much of the holding to sell, 1–100 (default 100)",
    index: 1,
    required: false,
    prompt: false,
    validate: (value: string) => (Number(value) > 0 && Number(value) <= 100 ? true : "--percent is between 1 and 100"),
  },
  slippageBps: { type: InputFieldType.Text, flag: "slippage-bps", message: "Slippage tolerance in basis points (default 100)", required: false, prompt: false },
  api: apiInput,
} satisfies InputSchema;

export default class JunoSell extends PluginCommand<TradeResult> {
  static override description = "Sell a share of a Juno coin, read from the chain to the wei: 100 sells all of it, with no dust left behind.";
  static override examples = ["<%= config.bin %> juno sell 0x975AfA7295D078e2D834124a9EA441BbcdBA9b48", "<%= config.bin %> juno sell 0x… 25"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "juno:sell";

  async execute(io: CommandIO): Promise<TradeResult> {
    const { token, percent, slippageBps, api } = await io.resolveInputs(inputs);
    const wallet = activeAddress(this.ctx.walletStateManager.read() as never);
    if (!wallet) throw new Error("No EVM wallet is set up. Run `mm init` first.");
    const executor = (await this.ctx.walletExecutor(io, this.pluginCommandId, { emitStepNotices: true })) as unknown as Executor;
    const fraction = percent ? Number(percent) / 100 : 1;
    return trade(io, executor, { api, token, side: "sell", wallet, sellFraction: fraction, slippageBps: slippageBps ? Number(slippageBps) : undefined });
  }

  override successHint(result: TradeResult): string {
    return [`Sold ${result.token}.`, ...result.transactions.map((t) => `${t.label}: ${t.url}`)].join("\n");
  }
}
