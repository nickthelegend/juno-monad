/**
 * Juno's API and the submit loop, kept free of the `mm` runtime so both can
 * be tested on their own.
 *
 * Juno's server builds every trade for the wallet that will sign it: the
 * right venue (the coin's bonding curve, its Uniswap v2 pair after
 * graduation, or its Kuru order book), the slippage floor, a deadline, and an
 * approval first when a USDC buy needs one. The plugin hands each step to the
 * MetaMask Agent Wallet's executor, which signs and sends it under the
 * wallet's own policy (Guard mode, simulation, 2FA). Juno never sees a key.
 */

export const DEFAULT_API = "https://juno-api-production-04ea.up.railway.app";

export type Step = {
  label: string;
  request: { chainId: number; from: string; to: string; data: string; value: string };
};

export type Coin = {
  address: string;
  name: string;
  symbol: string;
  priceUsd: number;
  marketCap: number;
  marketCapCurrency: string;
  marketCapChangePct: number | null;
  quote: { symbol: string; native: boolean };
  curve: { progress: number; graduated?: boolean };
  curvePreset: string;
  venue?: "curve" | "uniswap-v2" | "kuru";
  holders: number | null;
  creator?: { handle: string };
};

export type Position = {
  token: string;
  symbol: string;
  balance: number;
  value: number;
  unrealisedPnl: number | null;
  currency: string;
  graduated: boolean;
};

export type SwapBuild = {
  steps: Step[];
  quote: { amountOut?: number; minimumAmountOut?: number; priceImpactPct?: number; amountIn?: number };
  quoteSymbol: string;
  venue: "curve" | "kuru" | "uniswap-v2";
};

export class JunoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "JunoError";
  }
}

type Fetch = typeof globalThis.fetch;

export class JunoApi {
  constructor(
    readonly base: string = process.env.JUNO_API_URL?.trim() || DEFAULT_API,
    private readonly fetchImpl: Fetch = globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new JunoError(`Juno answered ${response.status} with something that is not JSON`, response.status);
    }
    if (!response.ok) {
      throw new JunoError((body as { error?: string })?.error ?? `Juno answered ${response.status}`, response.status);
    }
    return body as T;
  }

  config() {
    return this.request<{ network: string; chainId: number; explorer: string; localFork?: boolean; launchpad: string | null }>(
      "/api/juno/config",
    );
  }

  coins(sort: "marketCap" | "graduating" = "marketCap", limit = 20) {
    return this.request<{ coins: Coin[]; missing: number }>(`/api/juno/coins?limit=${limit}&sort=${sort}`);
  }

  coin(token: string) {
    return this.request<{ coin: Coin }>(`/api/juno/coins/${token}`);
  }

  portfolio(wallet: string) {
    return this.request<{ positions: Position[]; totalValue: number | null; currency: string; partial: boolean }>(
      `/api/juno/portfolio/${wallet}`,
    );
  }

  /** `amountIn` in quote units on a buy; on a sell, `sellFraction` of the holding (0 < f ≤ 1). */
  buildSwap(input: { token: string; side: "buy" | "sell"; owner: string; amountIn?: number; sellFraction?: number; slippageBps?: number }) {
    return this.request<SwapBuild>("/api/juno/tx/swap", {
      method: "POST",
      body: { amountIn: 0, ...input },
    });
  }
}

/** The MetaMask Agent Wallet executor, as `ctx.walletExecutor()` returns it. */
export type Executor = (
  request: {
    kind: "transaction";
    chainId: number;
    transaction: { to: string; data: string; value: string };
    intent?: string;
  },
  options?: { signal?: AbortSignal; noAwait?: boolean },
) => Promise<{ kind: string; hash?: string; status?: string; failureDescription?: string }>;

export type Landed = { label: string; hash: string; status: string };

/** Some steps landed and a later one did not: those are on chain, and the caller is told which. */
export class PartialSubmitError extends Error {
  constructor(
    message: string,
    readonly landed: Landed[],
  ) {
    super(message);
    this.name = "PartialSubmitError";
  }
}

const FAILED = new Set(["failed", "rejected", "reverted", "error", "cancelled", "canceled", "expired"]);

/**
 * Send the steps in order, waiting for each: a buy after an approval only
 * works once the approval has landed. Stops at the first step that does not
 * land and says what already did.
 */
export async function submitSteps(
  executor: Executor,
  steps: Step[],
  options: { intent: string; signal?: AbortSignal },
): Promise<Landed[]> {
  const landed: Landed[] = [];
  for (const [index, step] of steps.entries()) {
    const intent = steps.length > 1 ? `${options.intent} (step ${index + 1} of ${steps.length}: ${step.label})` : options.intent;
    let result: Awaited<ReturnType<Executor>>;
    try {
      result = await executor(
        {
          kind: "transaction",
          chainId: step.request.chainId,
          transaction: { to: step.request.to, data: step.request.data, value: step.request.value },
          intent,
        },
        { signal: options.signal },
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (landed.length === 0) throw error;
      throw new PartialSubmitError(`${landed.map((l) => l.label).join(", ")} went through, but ${step.label.toLowerCase()} did not: ${reason}`, landed);
    }
    const status = (result.status ?? "submitted").toLowerCase();
    if (!result.hash || FAILED.has(status)) {
      const reason = result.failureDescription ?? `the wallet answered ${status}`;
      if (landed.length === 0) throw new Error(`${step.label} did not go through: ${reason}`);
      throw new PartialSubmitError(`${landed.map((l) => l.label).join(", ")} went through, but ${step.label.toLowerCase()} did not: ${reason}`, landed);
    }
    landed.push({ label: step.label, hash: result.hash, status });
  }
  return landed;
}

const VENUE = { curve: "on its curve", "uniswap-v2": "on its Uniswap v2 pair", kuru: "on its Kuru order book" } as const;

export function describeVenue(venue: SwapBuild["venue"]): string {
  return VENUE[venue];
}

/** A coin as one line: `$AUTOP  Autopilot Test  $0.0063  mcap $1.00k  curve 4%`. */
export function coinLine(coin: Coin): string {
  const where = coin.curve.graduated ? (coin.venue === "kuru" ? "Kuru" : "Uniswap v2") : `curve ${Math.round(coin.curve.progress * 100)}%`;
  const change = coin.marketCapChangePct === null ? "" : ` ${coin.marketCapChangePct >= 0 ? "+" : ""}${coin.marketCapChangePct.toFixed(1)}%`;
  return `$${coin.symbol}  ${coin.name}  $${coin.priceUsd.toPrecision(3)}  mcap ${money(coin.marketCap)}${change}  ${where}  ${coin.address}`;
}

export function money(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}k`;
  return `$${value.toFixed(2)}`;
}

/** Turn an explorer base and a hash into a link (`${explorer}/tx/${hash}`). */
export function txUrl(explorer: string, hash: string): string {
  return `${explorer.replace(/\/$/, "")}/tx/${hash}`;
}
