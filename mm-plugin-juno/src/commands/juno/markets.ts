import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToFlags } from "@metamask/agent-wallet/plugin";

import { apiInput } from "../../lib/inputs.js";
import { type Coin, coinLine, JunoApi } from "../../lib/juno.js";

const inputs = {
  sort: {
    type: InputFieldType.Select,
    flag: "sort",
    message: "Order",
    options: [
      { value: "marketCap", label: "Market cap" },
      { value: "graduating", label: "Closest to graduating" },
    ],
    required: false,
    prompt: false,
  },
  limit: { type: InputFieldType.Text, flag: "limit", message: "How many", required: false, prompt: false },
  api: apiInput,
} satisfies InputSchema;

type Result = { network: string; coins: Coin[] };

export default class JunoMarkets extends PluginCommand<Result> {
  static override description = "Juno's markets on Monad: every post is a coin on a bonding curve, then a pair or a Kuru book.";
  static override examples = ["<%= config.bin %> juno markets", "<%= config.bin %> juno markets --sort graduating --limit 5 --json"];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  protected readonly pluginCommandId = "juno:markets";

  async execute(io: CommandIO): Promise<Result> {
    const { sort, limit, api } = await io.resolveInputs(inputs);
    const juno = new JunoApi(api || undefined);
    const [config, list] = await Promise.all([
      juno.config(),
      juno.coins((sort as "marketCap" | "graduating") || "marketCap", Math.min(Number(limit) || 10, 40)),
    ]);
    return { network: config.network, coins: list.coins };
  }

  override successHint(data: Result): string {
    if (data.coins.length === 0) return `No coins on Juno (${data.network}) yet.`;
    return [`Juno on ${data.network}:`, ...data.coins.map(coinLine)].join("\n");
  }
}
