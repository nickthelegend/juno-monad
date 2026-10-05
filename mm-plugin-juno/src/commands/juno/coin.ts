import { type CommandIO, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";

import { apiInput, tokenInput } from "../../lib/inputs.js";
import { type Coin, coinLine, JunoApi } from "../../lib/juno.js";

const inputs = { token: tokenInput, api: apiInput } satisfies InputSchema;

export default class JunoCoin extends PluginCommand<Coin> {
  static override description = "One Juno coin: price, market cap, where it trades, how far its curve has filled.";
  static override examples = ["<%= config.bin %> juno coin 0x14092A529e2e5EB4DECB4a1828f6aFa72e026360"];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "juno:coin";

  async execute(io: CommandIO): Promise<Coin> {
    const { token, api } = await io.resolveInputs(inputs);
    return (await new JunoApi(api || undefined).coin(token)).coin;
  }

  override successHint(coin: Coin): string {
    return coinLine(coin);
  }
}
