import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";

import { apiInput, positive, tokenInput } from "../../lib/inputs.js";
import type { Executor } from "../../lib/juno.js";
import { trade, type TradeResult } from "../../lib/trade.js";
import { activeAddress } from "../../lib/wallet.js";

const inputs = {
  token: tokenInput,
  amount: {
    type: InputFieldType.Text,
    flag: "amount",
    message: "How much to spend, in the coin's quote token (MON or USDC)",
    index: 1,
    prompt: true,
    validate: positive("--amount"),
  },
  slippageBps: { type: InputFieldType.Text, flag: "slippage-bps", message: "Slippage tolerance in basis points (default 100)", required: false, prompt: false },
  api: apiInput,
} satisfies InputSchema;

export default class JunoBuy extends PluginCommand<TradeResult> {
  static override description =
    "Buy a Juno coin: on its bonding curve, or on its Uniswap v2 pair or Kuru book once it has graduated. Juno builds it; the Agent Wallet signs it.";
  static override examples = ["<%= config.bin %> juno buy 0x975AfA7295D078e2D834124a9EA441BbcdBA9b48 1", "<%= config.bin %> juno buy --token 0x… --amount 5 --slippage-bps 200 --json"];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "juno:buy";

  async execute(io: CommandIO): Promise<TradeResult> {
    const { token, amount, slippageBps, api } = await io.resolveInputs(inputs);
    const wallet = activeAddress(this.ctx.walletStateManager.read() as never);
    if (!wallet) throw new Error("No EVM wallet is set up. Run `mm init` first.");
    const executor = (await this.ctx.walletExecutor(io, this.pluginCommandId, { emitStepNotices: true })) as unknown as Executor;
    return trade(io, executor, { api, token, side: "buy", wallet, amountIn: Number(amount), slippageBps: slippageBps ? Number(slippageBps) : undefined });
  }

  override successHint(result: TradeResult): string {
    const out = result.expectedOut === null ? "" : ` for about ${result.expectedOut.toPrecision(4)} tokens`;
    return [`Bought ${result.token}${out}.`, ...result.transactions.map((t) => `${t.label}: ${t.url}`)].join("\n");
  }
}
