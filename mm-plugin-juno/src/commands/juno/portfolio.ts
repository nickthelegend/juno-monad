import { type CommandIO, type InputSchema, PluginCommand, schemaToFlags } from "@metamask/agent-wallet/plugin";

import { apiInput } from "../../lib/inputs.js";
import { JunoApi, money, type Position } from "../../lib/juno.js";
import { activeAddress } from "../../lib/wallet.js";

const inputs = { api: apiInput } satisfies InputSchema;

type Result = { wallet: string; positions: Position[]; totalValue: number | null; currency: string; partial: boolean };

export default class JunoPortfolio extends PluginCommand<Result> {
  static override description = "This wallet's Juno coins: balance, value and unrealised P&L, marked where each coin trades now.";
  static override examples = ["<%= config.bin %> juno portfolio", "<%= config.bin %> juno portfolio --json"];
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = "juno:portfolio";

  async execute(io: CommandIO): Promise<Result> {
    const { api } = await io.resolveInputs(inputs);
    const wallet = activeAddress(this.ctx.walletStateManager.read() as never);
    if (!wallet) throw new Error("No EVM wallet is set up. Run `mm init` first.");
    const portfolio = await new JunoApi(api || undefined).portfolio(wallet);
    return { wallet, ...portfolio };
  }

  override successHint(result: Result): string {
    if (result.positions.length === 0) return `${result.wallet} holds no Juno coins.`;
    const lines = result.positions.map(
      (p) => `$${p.symbol}  ${p.balance.toPrecision(5)}  ${money(p.value)}${p.unrealisedPnl === null ? "" : `  P&L ${money(p.unrealisedPnl)}`}${p.graduated ? "  (graduated)" : ""}`,
    );
    const total = result.totalValue === null ? "" : `\nTotal ${money(result.totalValue)}${result.partial ? " (some pools could not be read)" : ""}`;
    return lines.join("\n") + total;
  }
}
