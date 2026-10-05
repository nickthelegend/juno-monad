import { type CommandIO, InputFieldType, type InputSchema, PluginCommand, schemaToArgs, schemaToFlags } from "@metamask/agent-wallet/plugin";

import { type AgentResult, fixtureModel, KIMI_MODEL, kimiModel, runAgent } from "../../lib/agent.js";
import { junoTools } from "../../lib/agent-tools.js";
import { apiInput, positive } from "../../lib/inputs.js";
import type { Executor } from "../../lib/juno.js";
import { activeAddress } from "../../lib/wallet.js";

const inputs = {
  instruction: {
    type: InputFieldType.Text,
    flag: "instruction",
    message: 'What to do, in words: "buy 2 MON of the coin closest to graduating"',
    index: 0,
    prompt: true,
  },
  maxSpend: {
    type: InputFieldType.Text,
    flag: "max-spend",
    message: "Most this request may spend, per quote token (default 5)",
    required: false,
    prompt: false,
    validate: positive("--max-spend"),
  },
  dryRun: { type: InputFieldType.Boolean, flag: "dry-run", message: "Plan and build, send nothing", required: false, prompt: false, default: false },
  model: { type: InputFieldType.Text, flag: "model", env: "JUNO_KIMI_MODEL", message: `Kimi model (default ${KIMI_MODEL})`, required: false, prompt: false },
  api: apiInput,
} satisfies InputSchema;

type Result = AgentResult & { model: string; wallet: string; dryRun: boolean };

export default class JunoAsk extends PluginCommand<Result> {
  static override description =
    "Say what to trade on Juno in words. Kimi plans it with tool calls (markets, coin, portfolio, buy, sell); every trade goes through the Agent Wallet, capped by --max-spend.";
  static override examples = [
    '<%= config.bin %> juno ask "buy 1 MON of the coin closest to graduating"',
    '<%= config.bin %> juno ask "what do I hold on Juno, and sell half of the biggest" --dry-run',
  ];
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "juno:ask";

  async execute(io: CommandIO): Promise<Result> {
    const { instruction, maxSpend, dryRun, model, api } = await io.resolveInputs(inputs);
    const wallet = activeAddress(this.ctx.walletStateManager.read() as never);
    if (!wallet) throw new Error("No EVM wallet is set up. Run `mm init` first.");

    const apiKey = process.env.MOONSHOT_API_KEY?.trim();
    const fixture = process.env.JUNO_KIMI_FIXTURE === "1";
    if (!apiKey && !fixture) throw new Error("Set MOONSHOT_API_KEY (platform.moonshot.ai) to let Kimi plan trades.");
    const modelName = apiKey ? model || KIMI_MODEL : "FIXTURE (not Kimi)";

    let executor: Executor | null = null;
    const result = await runAgent({
      model: apiKey ? kimiModel({ apiKey, model: model || undefined }) : fixtureModel,
      instruction,
      tools: junoTools({
        api,
        wallet,
        io,
        maxSpend: maxSpend ? Number(maxSpend) : 5,
        dryRun: Boolean(dryRun),
        executor: async () =>
          (executor ??= (await this.ctx.walletExecutor(io, this.pluginCommandId, { emitStepNotices: true })) as unknown as Executor),
      }),
      onStep: (step) => io.progress(`${step.tool}${step.ok ? "" : " (refused)"}`),
    });
    return { ...result, model: modelName, wallet, dryRun: Boolean(dryRun) };
  }

  override successHint(result: Result): string {
    const calls = result.steps.map((s) => `  ${s.ok ? "✓" : "✗"} ${s.tool}(${JSON.stringify(s.args)})`).join("\n");
    return `${result.answer}\n\n${result.model}${result.dryRun ? ", dry run" : ""}:\n${calls}`;
  }
}
