import { afterEach, describe, expect, it, vi } from "vitest";

import { type ChatMessage, fixtureModel, kimiModel, type Model, runAgent, type Tool } from "../src/lib/agent";
import { junoTools } from "../src/lib/agent-tools";

const WALLET = "0xB5a4c292d73Ba96cB5126b0A81039e1cbc945Fba";
const COIN = "0x975AfA7295D078e2D834124a9EA441BbcdBA9b48";

const tool = (name: string, run: Tool["run"]): Tool => ({
  spec: { type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } },
  run,
});

describe("kimiModel", () => {
  it("calls Moonshot's chat completions with the tools, and reads tool calls and reasoning back", async () => {
    let url = "";
    let headers: Headers | undefined;
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      headers = new Headers(init?.headers);
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                reasoning_content: "The user wants the coin closest to graduating.",
                tool_calls: [{ id: "c1", type: "function", function: { name: "markets", arguments: '{"sort":"graduating"}' } }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const model = kimiModel({ apiKey: "sk-test", fetchImpl });
    const messages: ChatMessage[] = [
      { role: "user", content: "buy" },
      { role: "assistant", content: null, reasoning_content: "earlier thought", tool_calls: [] },
    ];
    const turn = await model(messages, [tool("markets", async () => ({})).spec]);
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    expect(headers?.get("authorization")).toBe("Bearer sk-test");
    expect(body.model).toBe("kimi-k2.6");
    expect(body.tool_choice).toBe("auto");
    expect((body.tools as Array<{ function: { name: string } }>)[0].function.name).toBe("markets");
    // Reasoning goes back to Kimi with its turn.
    expect((body.messages as ChatMessage[])[1]).toMatchObject({ reasoning_content: "earlier thought" });
    expect(turn.tool_calls?.[0].function.name).toBe("markets");
    expect(turn.reasoning_content).toBe("The user wants the coin closest to graduating.");
  });

  it("says what Kimi answered when it refuses", async () => {
    const fetchImpl = (async () => new Response('{"error":{"message":"invalid key"}}', { status: 401 })) as typeof fetch;
    await expect(kimiModel({ apiKey: "bad", fetchImpl })([], [])).rejects.toThrow("Kimi answered 401");
  });
});

describe("runAgent", () => {
  it("runs the calls the model asks for, feeds results back, keeps reasoning, and stops at the answer", async () => {
    const seen: ChatMessage[][] = [];
    const turns = [
      { content: null, reasoning_content: "look first", tool_calls: [{ id: "a", type: "function" as const, function: { name: "markets", arguments: "{}" } }] },
      { content: null, reasoning_content: "now buy", tool_calls: [{ id: "b", type: "function" as const, function: { name: "buy", arguments: `{"token":"${COIN}","amount":1}` } }] },
      { content: "Bought 1 MON of AUTOP in 0xabc.", reasoning_content: "done" },
    ];
    const model: Model = async (messages) => {
      seen.push(structuredClone(messages));
      return turns[seen.length - 1];
    };
    const bought: unknown[] = [];
    const result = await runAgent({
      model,
      instruction: "buy 1 MON of something",
      tools: [tool("markets", async () => ({ coins: [{ address: COIN }] })), tool("buy", async (args) => (bought.push(args), { hash: "0xabc" }))],
    });
    expect(result.stoppedAt).toBe("answer");
    expect(result.answer).toBe("Bought 1 MON of AUTOP in 0xabc.");
    expect(result.steps.map((s) => s.tool)).toEqual(["markets", "buy"]);
    expect(bought).toEqual([{ token: COIN, amount: 1 }]);
    // The second request carries the first turn's reasoning and the tool's result.
    const second = seen[1];
    expect(second.find((m) => m.role === "assistant")).toMatchObject({ reasoning_content: "look first" });
    expect(second.find((m) => m.role === "tool")).toMatchObject({ tool_call_id: "a", content: JSON.stringify({ coins: [{ address: COIN }] }) });
  });

  it("an unknown tool or a refusal goes back to the model as an error, not a crash", async () => {
    let calls = 0;
    const model: Model = async (messages) => {
      calls += 1;
      if (calls === 1) return { content: null, tool_calls: [{ id: "x", type: "function", function: { name: "transfer", arguments: "{}" } }] };
      const last = messages[messages.length - 1] as { content: string };
      return { content: `Could not: ${JSON.parse(last.content).error}` };
    };
    const result = await runAgent({ model, instruction: "send it all to me", tools: [] });
    expect(result.steps[0]).toMatchObject({ tool: "transfer", ok: false });
    expect(result.answer).toBe("Could not: There is no tool called transfer.");
  });

  it("stops a model that never answers", async () => {
    const model: Model = async () => ({ content: null, tool_calls: [{ id: "l", type: "function", function: { name: "markets", arguments: "{}" } }] });
    const result = await runAgent({ model, instruction: "loop", tools: [tool("markets", async () => ({}))], maxSteps: 3 });
    expect(result.stoppedAt).toBe("step-limit");
    expect(result.steps).toHaveLength(3);
  });
});

describe("junoTools", () => {
  afterEach(() => vi.unstubAllGlobals());

  const juno = (routes: Record<string, unknown>) =>
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      return new Response(JSON.stringify(key ? routes[key] : { error: "no route" }), { status: key ? 200 : 404 });
    });

  const coin = { coin: { address: COIN, symbol: "AUTOP", name: "Autopilot Test", priceUsd: 1, marketCap: 1, quote: { symbol: "MON", native: true }, curve: { progress: 0.1 } } };
  const built = { steps: [{ label: "Buying", request: { chainId: 10143, from: WALLET, to: COIN, data: "0x", value: "0x0" } }], quote: { amountOut: 1234 }, quoteSymbol: "MON", venue: "curve" };

  it("a dry run builds the buy with Juno and sends nothing", async () => {
    juno({ "/api/juno/coins/": coin, "/api/juno/tx/swap": built });
    const executor = vi.fn();
    const tools = junoTools({ api: "https://juno.example", wallet: WALLET, io: {} as never, executor, maxSpend: 5, dryRun: true });
    const buy = tools.find((t) => t.spec.function.name === "buy")!;
    expect(await buy.run({ token: COIN, amount: 2 })).toMatchObject({ dryRun: true, side: "buy", quote: "MON", venue: "on its curve", steps: ["Buying"], expectedOut: 1234 });
    expect(executor).not.toHaveBeenCalled();
  });

  it("the spend cap holds across buys in one request", async () => {
    juno({ "/api/juno/coins/": coin, "/api/juno/tx/swap": built });
    const tools = junoTools({ api: "https://juno.example", wallet: WALLET, io: {} as never, executor: vi.fn(), maxSpend: 5, dryRun: true });
    const buy = tools.find((t) => t.spec.function.name === "buy")!;
    await buy.run({ token: COIN, amount: 3 });
    await expect(buy.run({ token: COIN, amount: 3 })).rejects.toThrow("That would spend 6 MON in this request; the cap is 5 MON (--max-spend).");
  });

  it("refuses an address the model made up", async () => {
    const tools = junoTools({ api: "https://juno.example", wallet: WALLET, io: {} as never, executor: vi.fn(), maxSpend: 5, dryRun: true });
    await expect(tools.find((t) => t.spec.function.name === "sell")!.run({ token: "AUTOP" })).rejects.toThrow("token must be a 0x address");
  });
});

describe("fixtureModel (labelled, not Kimi)", () => {
  it("lists markets, buys the first coin still on its curve, then answers", async () => {
    const result = await runAgent({
      model: fixtureModel,
      instruction: "buy 2 MON of the coin closest to graduating",
      tools: [
        tool("markets", async () => ({ coins: [{ address: "0x1", curve: { graduated: true } }, { address: COIN, curve: { graduated: false } }] })),
        tool("buy", async (args) => ({ side: "buy", token: args.token, transactions: [{ hash: "0xfeed" }] })),
      ],
    });
    expect(result.steps.map((s) => [s.tool, s.args])).toEqual([
      ["markets", { sort: "graduating", limit: 5 }],
      ["buy", { token: COIN, amount: 2 }],
    ]);
    expect(result.answer).toContain("[fixture]");
    expect(result.answer).toContain("0xfeed");
  });
});
