/**
 * `mm juno ask`: Kimi (Moonshot) plans a Juno trade in words and carries it
 * out through tool calls.
 *
 * The model gets five tools: the plugin's own functions. `markets`, `coin` and
 * `portfolio` read Juno. `buy` and `sell` build a trade with Juno and send it
 * through the Agent Wallet's executor, so every transaction still passes the
 * wallet's own policy (Guard mode, simulation, 2FA). Kimi decides which calls
 * to make and in what order; the plugin bounds what they can do:
 *
 * - a spend cap for the whole request (`--max-spend`, in each coin's quote
 *   token), checked before a buy is built;
 * - `--dry-run`, under which buy and sell only say what they would do;
 * - a step limit, so a model that loops stops.
 *
 * Kimi's API is OpenAI-compatible (`https://api.moonshot.ai/v1`,
 * `MOONSHOT_API_KEY`). Its thinking models return `reasoning_content` with
 * each assistant turn, and it must be sent back with that turn in later
 * requests, so the loop keeps it.
 */

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ModelTurn = { content: string | null; tool_calls?: ToolCall[]; reasoning_content?: string };

/** One completion. Given the conversation and the tools, the next assistant turn. */
export type Model = (messages: ChatMessage[], tools: ToolSpec[]) => Promise<ModelTurn>;

export const KIMI_BASE = "https://api.moonshot.ai/v1";
export const KIMI_MODEL = "kimi-k2.6";

export function kimiModel(options: { apiKey: string; model?: string; baseUrl?: string; fetchImpl?: typeof fetch }): Model {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  return async (messages, tools) => {
    const response = await fetchImpl(`${options.baseUrl ?? KIMI_BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({ model: options.model ?? KIMI_MODEL, messages, tools, tool_choice: "auto", temperature: 0.3 }),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Kimi answered ${response.status}: ${text.slice(0, 200)}`);
    const body = JSON.parse(text) as { choices?: Array<{ message?: ModelTurn }> };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("Kimi sent no message");
    return {
      content: message.content ?? null,
      tool_calls: message.tool_calls?.length ? message.tool_calls : undefined,
      reasoning_content: message.reasoning_content,
    };
  };
}

export type Tool = { spec: ToolSpec; run: (args: Record<string, unknown>) => Promise<unknown> };

export type AgentStep = { tool: string; args: Record<string, unknown>; ok: boolean; result: unknown };

export type AgentResult = { answer: string; steps: AgentStep[]; stoppedAt: "answer" | "step-limit" };

export const SYSTEM_PROMPT = `You are Juno's trading agent inside the MetaMask Agent Wallet CLI.
Juno is a social app on Monad where every post is a coin. Each coin trades on its own bonding curve until the curve fills, then on a Uniswap v2 pair or its own Kuru order book.
You act only through the tools. Read before you trade: look the coin up, or list markets, before buying.
Amounts for buy are in the coin's quote token (MON or USDC), never in dollars unless the coin is quoted in USDC.
Never invent a token address; use one a tool returned. If a tool refuses, say why in plain words and do not retry the same call.
When you are done, answer in two or three sentences: what you did, with each transaction hash, or why you did nothing.`;

export async function runAgent(input: {
  model: Model;
  tools: Tool[];
  instruction: string;
  maxSteps?: number;
  onStep?: (step: AgentStep) => void;
}): Promise<AgentResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input.instruction },
  ];
  const specs = input.tools.map((tool) => tool.spec);
  const byName = new Map(input.tools.map((tool) => [tool.spec.function.name, tool]));
  const steps: AgentStep[] = [];
  const maxSteps = input.maxSteps ?? 8;

  for (let turn = 0; turn < maxSteps; turn++) {
    const reply = await input.model(messages, specs);
    // The assistant turn goes back as it came, reasoning included.
    messages.push({
      role: "assistant",
      content: reply.content,
      ...(reply.tool_calls ? { tool_calls: reply.tool_calls } : {}),
      ...(reply.reasoning_content !== undefined ? { reasoning_content: reply.reasoning_content } : {}),
    });
    if (!reply.tool_calls?.length) return { answer: reply.content ?? "", steps, stoppedAt: "answer" };

    for (const call of reply.tool_calls) {
      const tool = byName.get(call.function.name);
      let args: Record<string, unknown> = {};
      let step: AgentStep;
      try {
        args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        if (!tool) throw new Error(`There is no tool called ${call.function.name}.`);
        step = { tool: call.function.name, args, ok: true, result: await tool.run(args) };
      } catch (error) {
        step = { tool: call.function.name, args, ok: false, result: { error: error instanceof Error ? error.message : String(error) } };
      }
      steps.push(step);
      input.onStep?.(step);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(step.result) });
    }
  }
  return { answer: `Stopped after ${maxSteps} model turns without a final answer.`, steps, stoppedAt: "step-limit" };
}
