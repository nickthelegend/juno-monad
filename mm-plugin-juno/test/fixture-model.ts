import type { ChatMessage, Model, ModelTurn } from "../src/lib/agent";

/**
 * TEST DOUBLE, not Kimi: a fixed planner for the agent loop's tests and the
 * fork E2E when there is no `MOONSHOT_API_KEY`. It reads the request for
 * "buy N" or "sell", lists markets or looks the coin up, makes the one trade,
 * and answers. It is not shipped: the `ask` command runs on Kimi only.
 */
export const fixtureModel: Model = async (messages) => {
  const user = (messages.find((m) => m.role === "user") as { content: string }).content.toLowerCase();
  const toolResults = messages.filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool").map((m) => JSON.parse(m.content));
  const call = (name: string, args: Record<string, unknown>): ModelTurn => ({
    content: null,
    reasoning_content: `[fixture] calling ${name}`,
    tool_calls: [{ id: `call_${messages.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  });
  const address = user.match(/0x[0-9a-f]{40}/)?.[0];
  const amount = Number(user.match(/buy\s+([0-9.]+)/)?.[1] ?? "1");
  const selling = /\bsell\b/.test(user);

  if (toolResults.length === 0) {
    if (address) return call("coin", { token: address });
    return call("markets", { sort: /graduat/.test(user) ? "graduating" : "marketCap", limit: 5 });
  }
  if (toolResults.length === 1) {
    const first = toolResults[0];
    if (first.error) return { content: `[fixture] Nothing done: ${first.error}` };
    const coin = first.coins ? first.coins.find((c: { curve: { graduated?: boolean } }) => !c.curve.graduated) ?? first.coins[0] : first;
    if (!coin?.address) return { content: "[fixture] No coin to trade." };
    return selling ? call("sell", { token: coin.address, percent: 100 }) : call("buy", { token: coin.address, amount });
  }
  const last = toolResults[toolResults.length - 1];
  if (last.error) return { content: `[fixture] The trade did not happen: ${last.error}` };
  const hashes = (last.transactions ?? []).map((t: { hash: string }) => t.hash).join(", ");
  return { content: `[fixture] Done: ${last.side ?? "trade"} ${last.token ?? ""} in ${hashes || "a dry run"}.` };
};
