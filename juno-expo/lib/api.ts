import Constants from "expo-constants";

/**
 * The Juno API client.
 *
 * Every read and every transaction comes from the Next.js app. The phone never
 * builds a Monad transaction — it asks for unsigned EIP-1559 requests, signs
 * them with the key in its secure store, and posts the signed bytes back. See
 * `lib/juno/tx.ts` on the server and `docs/API.md` for the contract.
 *
 * ## Finding the server from a simulator
 *
 * `localhost` inside an iOS Simulator is the simulator, not the Mac running the
 * dev server, so a hardcoded localhost fails in exactly the environment this
 * app is demoed in. Expo already knows the host it was served from
 * (`hostUri`), which is the machine running Metro — and that is the same
 * machine running Next. So the default is derived rather than guessed, and
 * `EXPO_PUBLIC_API_URL` overrides it for a deployed backend.
 */

function inferredHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older/dev-client shapes keep it in different places.
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost;
  if (!hostUri) return null;
  const host = hostUri.split(":")[0];
  if (!host) return null;
  return `http://${host}:3000`;
}

/*
 * `||`, not `??`: eas.json sets the variable to an empty string so a build
 * never inherits a stale deployment's URL, and an empty base URL would send
 * every request to a relative path — which on a phone is nowhere.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ||
  inferredHost() ||
  "http://localhost:3000";

export class ApiError extends Error {
  readonly status: number;
  /** A request abandoned at its timeout, as opposed to one that never connected. */
  timedOut = false;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * One request.
 *
 * A phone loses its network mid-request far more often than a browser does, so
 * a timeout is mandatory rather than optional: without one a dropped connection
 * leaves a spinner on screen forever with nothing to cancel it.
 */
async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  try {
    return await attempt<T>(path, init);
  } catch (error) {
    /*
     * One quiet retry for a read that never got an answer.
     *
     * A dropped connection — a proxy recycling, a phone changing networks —
     * surfaces as a fetch that throws before any response, and the coin page a
     * launch lands on said "Could not reach Juno" for a server that answered
     * the retry in under a second. Reads only: a POST may have reached the
     * server, and sending a transaction twice is not a retry. A timeout is not
     * retried either: the server was reached and is slow, and a second wait of
     * the same length helps nobody.
     */
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" || !(error instanceof ApiError) || error.status !== 0 || error.timedOut) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    return attempt<T>(path, init);
  }
}

async function attempt<T>(path: string, init: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = 45_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(rest.body ? { "content-type": "application/json" } : {}),
        ...rest.headers,
      },
    });

    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // A non-JSON body from a 500 is still worth surfacing as a message.
      if (!response.ok) throw new ApiError(text.slice(0, 200) || "Request failed", response.status);
      throw new ApiError("The server sent something that was not JSON", response.status);
    }

    if (!response.ok) {
      const message =
        (body as { error?: string } | null)?.error ?? `Request failed (${response.status})`;
      throw new ApiError(message, response.status);
    }

    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      const timedOut = new ApiError("The request timed out. Check your connection.", 0);
      timedOut.timedOut = true;
      throw timedOut;
    }
    throw new ApiError(
      `Could not reach Juno at ${API_URL}. Is the server running?`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T>(path: string, timeoutMs?: number) => request<T>(path, { timeoutMs }),
  post: <T>(path: string, body: unknown, timeoutMs?: number) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body), timeoutMs }),
  patch: <T>(path: string, body: unknown, timeoutMs?: number) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body), timeoutMs }),
  delete: <T>(path: string, timeoutMs?: number) => request<T>(path, { method: "DELETE", timeoutMs }),
  /** A DELETE whose request is signed, so its proof travels in the body rather than the URL. */
  del: <T>(path: string, body: unknown, timeoutMs?: number) =>
    request<T>(path, { method: "DELETE", body: JSON.stringify(body), timeoutMs }),
};

/* ------------------------------------------------------------------ */
/* Chain constants                                                     */
/* ------------------------------------------------------------------ */

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** Which Monad network a row belongs to. Every server row is scoped to one. */
export type Network = "monad-testnet" | "monad";

/**
 * Native MON, wherever a token address is expected.
 *
 * MON is not an ERC-20, so it has no contract address of its own. The API uses
 * the zero address for it — a quote token, a balance read — and the app does
 * the same rather than inventing a second spelling.
 */
export const MON_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

/**
 * Circle's USDC on each network — the quote token of Juno's USDC-priced pools.
 *
 * Fallbacks only. The server's `GET config` names the quote tokens it actually
 * accepts, and that list wins whenever it has been read; these exist so a
 * balance can still be shown against a server that predates the endpoint.
 */
export const USDC_ADDRESS: Record<Network, Address> = {
  "monad-testnet": "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  monad: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
};

/** MonadVision, per network. Also a fallback: `config.explorer` wins. */
const EXPLORERS: Record<Network, string> = {
  "monad-testnet": "https://testnet.monadvision.com",
  monad: "https://monadvision.com",
};

/**
 * The network assumed before `GET config` has answered.
 *
 * Testnet, because that is where Juno runs today and where a wrong guess costs
 * nothing. Nothing is *signed* against this: every transaction carries the
 * chain id the server built it for.
 */
const DEFAULT_NETWORK: Network = "monad-testnet";

/** "Monad testnet", for a details row. An unknown value is shown as itself, not guessed at. */
export function networkLabel(network: string | null | undefined): string {
  const name =
    network === "monad-testnet" ? "Monad testnet" : network === "monad" ? "Monad mainnet" : (network ?? "—");
  // A local fork has the testnet's chain id and state, but it is not the
  // network, and a label that said so would pass one off as the other.
  return network && configLoaded?.localFork ? `${name} (local fork)` : name;
}

/** True for native MON, however the address happens to be cased. */
export function isNative(address: string | null | undefined): boolean {
  return !!address && /^0x0{40}$/i.test(address);
}

/* ------------------------------------------------------------------ */
/* Shapes, mirroring the server's own types                            */
/* ------------------------------------------------------------------ */

export type QuoteToken = {
  /** ERC-20 address; the zero address is native MON. */
  address: Address;
  symbol: string;
  decimals: number;
  /** Native MON is paid as `msg.value` and needs no approval step. */
  native: boolean;
  icon?: string;
};

/** What `GET config` answers: which chain, and where to look things up on it. */
export type ChainConfig = {
  network: Network;
  chainId: number;
  rpcUrl: string;
  /**
   * The server's RPC is a local fork of Monad testnet, so a measured
   * confirmation time is the fork's. Absent on an older server.
   */
  localFork?: boolean;
  launchpad: string | null;
  /** MonadVision base URL. Links are `${explorer}/tx/${hash}` and so on. */
  explorer: string;
  quoteTokens: QuoteToken[];
  /** Whether `POST faucet` will answer — testnet only. */
  faucet: boolean;
  /**
   * Where a launch may graduate, and which quote tokens each venue takes.
   * Uniswap v2 always; Kuru on deployments with a Kuru graduator (testnet).
   * Absent on an older server, which offers Uniswap v2 only.
   */
  venues?: Array<{ id: Venue; name: string; quotes: string[] }>;
  /**
   * Whether a coin that graduated into Uniswap v2 can be traded in the app
   * (the deployment has Juno's swap router). Absent on an older server.
   */
  v2Trading?: boolean;
  /** Privy session signers and gas sponsorship. Absent on an older server. */
  autopilot?: AutopilotConfig;
};

/**
 * Autopilot: Juno sends trades for a Privy wallet, inside a Privy policy
 * written for that wallet, and Privy pays the gas. `off` when the server has
 * no Privy signer set up.
 */
export type AutopilotConfig = {
  mode: "privy" | "off";
  /** The key quorum the app adds to the wallet as a signer. */
  signerId: string | null;
  /** Privy pays the gas for autopilot's transactions. */
  sponsor: boolean;
  maxPerTradeMon: number;
  days: number;
};

export type AutopilotRun = {
  wallet: string;
  kind: "plan" | "trade";
  planId: string | null;
  label: string;
  hash: Hex | null;
  via: "privy";
  sponsored: boolean;
  error: string | null;
  at: string;
};

export type AutopilotStatus = {
  mode: AutopilotConfig["mode"];
  status: "off" | "pending" | "active" | "expired";
  expiresAt: string | null;
  policyId: string | null;
  signerId: string | null;
  sponsor: boolean;
  maxPerTradeMon: number;
  /** The policy's rules by name: everything Juno may send for this wallet. */
  allows: string[];
  runs: AutopilotRun[];
};

/** The person's Privy session token, which the server verifies. */
export type AutopilotProof = { accessToken: string };

/** A Perpl perpetual market, live. Prices USD; `fundingRate` per interval as a ratio. */
export type PerpMarket = {
  id: number;
  symbol: string;
  open: boolean;
  mark: number;
  oracle: number;
  last: number;
  change24h: number | null;
  volume24hUsd: number;
  openInterestUsd: number;
  fundingRate: number;
  fundingIntervalSec: number;
  maxLeverage: number;
  takerFee: number;
  priceDecimals: number;
  lotDecimals: number;
  at: number;
};

export type PerpPosition = {
  perpId: number;
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  collateral: number;
  pnl: number;
  funding: number;
  liquidationPrice: number | null;
  markValid: boolean;
};

export type PerpAccount = {
  owner: string;
  accountId: string | null;
  balance: number;
  locked: number;
  walletAusd: number;
  positions: PerpPosition[];
  minimumOpen: number;
  /** Agora's AUSD faucet exists here (testnet). Absent from older servers. */
  ausdFaucet?: boolean;
};

/** One Perpl market's risk: funding, premium to the oracle, realised volatility. */
export type MarketRisk = {
  id: number;
  symbol: string;
  mark: number;
  premium: number | null;
  fundingRate: number;
  fundingAnnualized: number;
  funding24h: Array<{ t: number; rate: number }>;
  fundingCost24hPer1kLong: number;
  volatility: number | null;
  high24h: number | null;
  low24h: number | null;
  openInterestUsd: number;
  volume24hUsd: number;
  maxLeverage: number;
};

/** An open position measured against its market. */
export type PositionRisk = {
  perpId: number;
  symbol: string;
  side: "long" | "short";
  notional: number;
  equity: number;
  effectiveLeverage: number | null;
  liquidationPrice: number | null;
  liquidationDistance: number | null;
  health: number | null;
  fundingPerDay: number;
  pnlAt10PctAdverse: number;
};

/** A limit order resting on a Kuru book, as the book holds it now. */
export type KuruOrder = { orderId: string; isBuy: boolean; price: number; size: number; remaining: number };

/** Where a curve graduates: a Uniswap v2 pair, or a Kuru order-book market. */
export type Venue = "uniswap-v2" | "kuru";

/** A graduated coin's Kuru market: the top of its book, in MON per token. */
export type KuruMarketView = {
  market: string;
  bestBid: number;
  bestAsk: number;
  /** (ask - bid) / mid; null without both sides. */
  spread: number | null;
  takerFeeBps: number;
};

export type CurveState = {
  progress: number;
  raisedUsd: number;
  thresholdUsd: number;
  /**
   * The curve has filled and trading on it is closed, but nobody has sent the
   * graduation transaction yet. Anyone may; until someone does, neither the
   * curve nor the pair will take a trade.
   */
  complete: boolean;
  graduated: boolean;
};

export type NavReference = {
  feed: string;
  priceUsd: number;
  /** Null when the curve and the reference cannot be compared — see `unitsPerToken`. */
  deviation: number | null;
  updatedAt: string;
  bandBps: number;
  withinBand: boolean | null;
  /** The curve's price restated in the reference's units. Null without a ratio. */
  impliedUsd: number | null;
  /** How much of the reference one token stands for, fixed at launch. */
  unitsPerToken: number | null;
  /** `"mark"` is a published price with no timestamp — freshness is unknown. */
  state: "live" | "closed" | "stale" | "mark";
  /** Null when the source publishes no timestamp, as Tessera does not. */
  ageSeconds: number | null;
  source: "pyth" | "tessera";
  /** The same comparison attested on Monad by Chainlink CRE (`JunoNavOracle`). Absent on an older server. */
  attested?: {
    oracle: string;
    navUsd: number;
    impliedUsd: number;
    premium: number;
    withinBand: boolean;
    bandBps: number;
    observedAt: string;
  } | null;
  /** Present only on a Tessera reference: a company, not a ticker. */
  tessera: {
    id: string;
    sector: string;
    holders: number;
    markValuation: number;
    supply: number | null;
  } | null;
};

export type Coin = {
  /** The token's address — the coin's id, and the `/coin/[token]` route. */
  address: string;
  format: "post" | "reel";
  name: string;
  symbol: string;
  description?: string;
  media: { kind: "image" | "video"; url: string; posterUrl?: string; width: number; height: number };
  creator: { handle: string; displayName: string; avatarUrl: string; wallet: string };
  createdAt: string;
  /** On Monad a pool is keyed by its token inside the launchpad, so this equals `address`. */
  pool: string;
  /** The launchpad contract holding the curve. */
  launchpad: string;
  quote: QuoteToken;
  /**
   * USD price of one quote token, or null when no feed answered.
   *
   * Quote-denominated figures — a recurring-buy amount, a contribution — are
   * signed for in quote units; this is what converts them for display, and
   * null has to stay null rather than collapsing to one-to-one.
   */
  quoteUsdRate: number | null;
  marketCap: number;
  marketCapCurrency: string;
  marketCapChangePct: number | null;
  volume24h: number | null;
  totalVolume: number | null;
  /**
   * What the creator can claim right now, in `marketCapCurrency`.
   *
   * Read from the pool's own fee balance, so it drops to zero after a claim —
   * a lifetime total would invite someone to press Claim for money already in
   * their wallet.
   */
  creatorRewards: number;
  /** Creator fees already claimed, in `marketCapCurrency`. With `creatorRewards`, the lifetime total. */
  creatorRewardsClaimed?: number;
  /** Fills in the coin's history; null when unread. */
  tradeCount?: number | null;
  holders: number | null;
  priceUsd: number;
  priceHistory?: Array<{ t: string; price: number; volume: number; side: "buy" | "sell" }>;
  /** The swap read was cut short — the ticks above are a prefix, not the history. */
  priceHistoryPartial?: boolean;
  nav?: NavReference | null;
  curve: CurveState;
  curvePreset: string;
  /**
   * What the market is marked against, from the registry. Null for a post or
   * reel; undefined from a server that predates the field.
   */
  reference?: { source: "pyth" | "tessera"; id: string } | null;
  /**
   * The Uniswap v2 pair this coin graduates into.
   *
   * Created at launch and locked until graduation, so it is known — and
   * linkable — before the curve fills. Null or absent when the server could
   * not say, which is not the same as there being no pair.
   */
  pair?: string | null;
  /** Where the curve graduates, chosen at launch. Absent on an older server. */
  venue?: Venue;
  /** The coin's Kuru market once it has graduated there; null otherwise. */
  kuru?: KuruMarketView | null;
  /** Present when the list was asked for `social=1`. */
  likes?: number;
  commentCount?: number;
  viewerLiked?: boolean | null;
};

/** A pre-IPO company as Tessera publishes it, with the Juno markets marked against it. */
export type TesseraCompany = {
  id: string;
  name: string;
  sector: string;
  markPrice: number;
  holders: number;
  markValuation: number;
  supply: number | null;
  floatUsd: number | null;
  shareOfCompany: number | null;
  markets: Array<{
    address: string;
    name: string;
    symbol: string;
    /** Null when the curve could not be read just now; the market still exists. */
    priceUsd: number | null;
    marketCap: number | null;
    currency: string | null;
    curvePreset: string;
    progress: number | null;
    graduated: boolean | null;
    deviation: number | null;
    withinBand: boolean | null;
  }>;
};

export type Activity = {
  id: string;
  side: "buy" | "sell";
  actor: { handle: string; avatarUrl: string };
  /** Who signed it. The handle is a shortened form of this, not a key. */
  wallet: string;
  amount: number;
  valueUsd: number;
  timestamp: string;
  /** The transaction that made the trade. */
  txHash?: string;
};

export type Holder = {
  rank: number;
  actor: { handle: string; avatarUrl: string };
  wallet: string;
  balance: number;
  share: number;
};

export type FeedItem =
  | {
      kind: "trade";
      id: string;
      timestamp: string;
      side: "buy" | "sell";
      amount: number;
      valueUsd: number;
      price: number;
      priceNow: number | null;
      currency: string;
      txHash?: string;
      /** What the trader said about this fill when they signed it, if anything. */
      note: string | null;
      actor: { wallet: string; handle: string; avatarUrl: string };
      coin: {
        address: string;
        name: string;
        symbol: string;
        mediaUrl: string | null;
        mediaKind: string;
        posterUrl: string | null;
      };
    }
  | {
      kind: "post";
      id: string;
      timestamp: string;
      body: string;
      author: { wallet: string; handle: string; avatarUrl: string };
      mediaUrl: string | null;
      mediaKind: string | null;
      replyCount: number;
      /** The market this post is about, priced. Price is null when unread. */
      coin: {
        address: string;
        name: string;
        symbol: string;
        priceUsd: number | null;
        currency: string;
        changePct: number | null;
        progress: number | null;
        graduated: boolean;
        /** Null when the holder read was refused — not "held by nobody". */
        holders: number | null;
      } | null;
    };

export type PositionTrade = {
  t: string;
  side: "buy" | "sell";
  base: number;
  /** The mark right after the trade — what the value chart plots, not what was paid. */
  price: number;
  /** What was paid (buy, fee included) or received (sell). Absent on an older server. */
  quote?: number;
};

export type Position = {
  /** The coin's token address. */
  token: string;
  name: string;
  symbol: string;
  mediaUrl: string | null;
  mediaMime: string | null;
  /** A reel's poster frame. Absent from a server older than 7 Oct. */
  posterUrl?: string | null;
  curvePreset: string;
  balance: number;
  price: number;
  value: number;
  averageCost: number | null;
  unrealisedPnl: number | null;
  unrealisedPnlPct: number | null;
  realisedPnl: number;
  currency: string;
  graduated: boolean;
  trades: PositionTrade[];
};

export type Portfolio = {
  wallet: string;
  positions: Position[];
  /** Null when the pool walk did not finish and found nothing — not "$0". */
  totalValue: number | null;
  totalPnl: number | null;
  totalPnlPct: number | null;
  currency: string;
  partial: boolean;
  /** What the wallet was worth at each moment it traded, oldest first. */
  history: Array<{ t: string; value: number }>;
};

export type PostDetail = {
  id: string;
  body: string;
  timestamp: string;
  author: { wallet: string; handle: string; avatarUrl: string };
  mediaUrl: string | null;
  mediaKind: string | null;
};

/** A comment on a coin. `side` and `txHash` are set when it came with a trade. */
export type CoinComment = {
  id: string;
  token: string;
  wallet: string;
  body: string;
  side?: "buy" | "sell";
  txHash?: string;
  createdAt: string;
};

/** Who else is in this market, derived from the fills the chart is drawn from. */
export type Crowd = {
  /** USD per quote token, or 1 when no feed answered. Flow figures are in quote units. */
  quoteUsdRate: number;
  traders: number;
  holdersStill: number;
  firstBuyer: {
    wallet: string;
    price: number;
    timestamp: string;
    multiple: number | null;
  } | null;
  netFlow24h: number;
  netFlow7d: number;
  fills24h: number;
  biggestBuy: number | null;
  /** The swap walk was cut short — these are floors, not totals. */
  partial: boolean;
};

export type DepthPoint = {
  amountIn: number;
  amountOut: number;
  averagePrice: number;
  /** Total shortfall against spot, fee included. */
  priceImpact: number;
  /** The part the curve caused, fee excluded. */
  curveImpact: number;
  fee: number;
};

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

/**
 * One EIP-1559 transaction the server built and the device signs.
 *
 * Every number is hex so it survives JSON; the wallet turns them back into
 * bigints before signing (see `lib/wallet.tsx`). Nonces across a batch are
 * consecutive, which is what lets every step be signed up front.
 */
export type UnsignedTransaction = {
  /** "Buying", "Approving USDC", "Opening its market" — said while it runs. */
  label: string;
  request: {
    type: "eip1559";
    chainId: number;
    from: Address;
    to: Address;
    data: Hex;
    value: Hex;
    nonce: number;
    gas: Hex;
    maxFeePerGas: Hex;
    maxPriorityFeePerGas: Hex;
  };
};

/** What `POST tx/submit` answers once the receipt is in. */
export type SubmitResult = {
  hash: Hex;
  blockNumber: number;
  from: Address;
  /** Trades the transaction made, as the server recorded them. */
  trades: number;
  /** Set when the transaction launched a token. */
  launched?: { token: Address; pair: Address | null; creator: Address };
  /** What a Perpl order did: whether it opened or closed a position, and any size left unfilled. */
  perp?: {
    /** `pricePNS` is the fill price in the market's price units (`priceDecimals`). Absent on an older server. */
    opened?: { perpId: number; lots: string; pricePNS?: string };
    closed?: { perpId: number };
    unfilledLots?: string;
    totalLots?: string;
  };
  /** Set when the transaction graduated a curve. */
  graduated?: { token: Address; venue: Address };
  /** Set when a buy filled a curve to its top. */
  completed?: Address[];
  /** Milliseconds from broadcast to a receipt in hand, as the server measured it. */
  confirmedInMs?: number;
};

export type SwapBuild = {
  /** In order. Usually one; an approval first when a USDC buy needs one. */
  steps: UnsignedTransaction[];
  /**
   * When the built swap stops being valid, in unix seconds. Signed after it,
   * the swap reverts on-chain with `Expired` — so the app re-quotes instead of
   * submitting something stale.
   */
  window: { deadline: number };
  quote: {
    amountOut: number;
    minimumAmountOut: number;
    amountUsed: number;
    fee: number;
    priceImpact: number;
    curveImpact: number;
    /** Exact-out buys only: the expected cost, and the most the transaction may spend. */
    amountIn?: number;
    maximumAmountIn?: number;
  };
  quoteSymbol: string;
  quoteUsdRate: number | null;
  /** Where the order goes: the curve, or after graduation the Kuru market or the v2 pair. */
  venue?: "curve" | "kuru" | "uniswap-v2";
  market?: string;
  pair?: string;
};

export type LaunchBuild = {
  steps: UnsignedTransaction[];
  /** Where the token will be deployed — predicted by the launchpad before it exists. */
  token: Address;
  launchpad: Address;
  /** What the curve raises before it graduates, in quote units. */
  migrationQuoteThreshold: number;
};

/* ------------------------------------------------------------------ */
/* Social trading and savings                                          */
/* ------------------------------------------------------------------ */

export type Trader = {
  wallet: string;
  /** Profit already taken. The rank is on this and nothing else. */
  realised: number;
  /** Open position against cost. Null when the buys predate the read window. */
  unrealised: number | null;
  trades: number;
  coins: number;
  /** Null when no sell had a cost to compare against — unmeasured, not zero. */
  winRate: number | null;
  bestExit: number | null;
  holding: number;
  isCreator: boolean;
  followers: number;
};

/** One notification, built from something that already happened (see lib/juno/inbox.ts). */
export type InboxItem =
  | { id: string; kind: "trade"; at: string; actor: string; token: string; symbol: string; side: "buy" | "sell"; base: number; quote: number; quoteSymbol: string; txHash: string }
  | { id: string; kind: "follow"; at: string; actor: string }
  | { id: string; kind: "comment"; at: string; actor: string; token: string; symbol: string; body: string }
  | { id: string; kind: "like"; at: string; actor: string; token: string; symbol: string }
  | { id: string; kind: "alert"; at: string; token: string; symbol: string; direction: "up" | "down"; alertPrice: number; priceNow: number }
  | { id: string; kind: "plan"; at: string; token: string; symbol: string; amount: number; cadence: string };

/** `GET /api/juno/notifications?wallet=`. */
export type Inbox = { items: InboxItem[]; unread: number; seenAt: string | null };

/** `GET /api/juno/staking`. */
export type StakingView = {
  network: "monad-testnet" | "monad";
  epoch: number;
  inEpochDelayPeriod: boolean;
  effectiveEpoch: number;
  proposer: { id: number; authAddress: string; stakeMon: number; commissionPct: number; unclaimedRewardsMon: number };
  validators: number | null;
  delegations: number[] | null;
  at: string;
};

/** `GET /api/juno/heartbeat`: Monad's network, never the local fork. */
export type Heartbeat = {
  network: "monad-testnet" | "monad";
  source: string;
  connected: boolean;
  error: string | null;
  /** This app's own trades run on a local fork. */
  appOnFork: boolean;
  blocks: Array<{
    number: number;
    state: "Proposed" | "Voted" | "Finalized" | "Verified";
    votedMs: number | null;
    finalizedMs: number | null;
    verifiedMs: number | null;
  }>;
  votedMs: number | null;
  finalizedMs: number | null;
  verifiedMs: number | null;
  blockMs: number | null;
};

/** `GET /api/juno/stats`. */
export type JunoStats = {
  network: string;
  localFork: boolean;
  coins: number | null;
  trades24h: number | null;
  traders24h: number | null;
  block: { number: number; timestamp: number } | null;
  /** Confirmation times the server measured; null before it has submitted anything. */
  confirmation: { lastMs: number; lastAt: string; medianMs: number; samples: number } | null;
  /** How many of the feed's pictures the server holds in memory, of how many. */
  pictures: { held: number; total: number } | null;
  at: string;
};

/** `GET /api/juno/tx/cost?hash=`. Dollar figures are null when their price feed was unreadable. */
export type TxCost = {
  hash: string;
  blockNumber: number;
  localFork: boolean;
  monad: {
    gasUsed: number;
    gasLimit: number;
    /** Monad bills the gas limit; an anvil fork bills the gas used. */
    billed: "limit" | "used";
    gasCharged: number;
    gasPriceGwei: number;
    feeMon: number;
    feeUsd: number | null;
  };
  /** Null when Ethereum's gas price could not be read: no comparison is shown. */
  ethereum: {
    gasPriceGwei: number;
    feeEth: number;
    feeUsd: number | null;
    ethUsd: number | null;
    blockSeconds: number;
    gasPriceSource: string;
    ethUsdAgeSeconds: number | null;
  } | null;
};

/** `GET /api/juno/profiles/<wallet>`. */
export type CreatorProfile = {
  network: Network;
  wallet: string;
  /** Each null when never set. */
  name: string | null;
  bio: string | null;
  link: string | null;
  /** An X account verified through Privy, when there is one. */
  identity: { twitter?: string; emailVerified: boolean; via: "privy"; verifiedAt: string } | null;
  followers: number;
  following: number;
  /** Null when no viewer was given. */
  viewerFollows: boolean | null;
  /** Every listed coin this wallet launched, newest first. */
  coins: Coin[];
  /** Coins the chain read could not price: the list is short by this many. */
  missing: number;
};

export type WatchItem = {
  token: string;
  watchedAt: string;
  alertPrice: number | null;
  /** Null when the coin could not be priced: an alert cannot be judged against a price nobody read. */
  alertCrossed: "up" | "down" | null;
  coin: {
    address: string;
    name: string;
    symbol: string;
    priceUsd: number;
    marketCap: number;
    currency: string;
    changePct: number | null;
    progress: number;
    graduated: boolean;
    media: { kind: "image" | "video"; url: string; posterUrl?: string };
  } | null;
};

export type Plan = {
  id: string;
  token: string;
  amount: number;
  cadence: "daily" | "weekly" | "monthly";
  target: number | null;
  /** Only moves when a swap confirms — a record of transactions, not intentions. */
  contributed: number;
  fills: number;
  lastFilledAt: string | null;
  nextDueAt: string;
  due: boolean;
  active: boolean;
  /**
   * `amount`, `target` and `contributed` are **quote-token units** — MON or
   * USDC, whatever this pool is priced in, because that is what a buy is
   * signed for. `quoteSymbol` labels them; `quoteUsdRate` converts them, and
   * is null when no feed answered.
   */
  coin: {
    address: string;
    name: string;
    symbol: string;
    priceUsd: number;
    currency: string;
    quoteSymbol: string;
    quoteUsdRate: number | null;
    media?: { kind: "image" | "video"; url: string; posterUrl?: string };
  } | null;
};

/* ------------------------------------------------------------------ */
/* Configuration, read once                                            */
/* ------------------------------------------------------------------ */

/**
 * `GET config`, shared for the life of the app.
 *
 * It names the network, the explorer and the quote tokens — facts that do not
 * change while the app is open, so one read serves every screen. A failed read
 * is not kept: the next caller asks again rather than inheriting the failure.
 */
let configRead: Promise<ChainConfig> | null = null;
let configLoaded: ChainConfig | null = null;

function readConfig(): Promise<ChainConfig> {
  if (configRead) return configRead;
  const value = api.get<ChainConfig>("/api/juno/config").then((config) => {
    configLoaded = config;
    return config;
  });
  configRead = value;
  value.catch(() => {
    if (configRead === value) configRead = null;
  });
  return value;
}

/** The explorer to link to: the server's, once known; MonadVision for the assumed network until then. */
function explorerBase(): string {
  return (configLoaded?.explorer ?? EXPLORERS[configLoaded?.network ?? DEFAULT_NETWORK]).replace(/\/$/, "");
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

export const juno = {
  /** Which chain the server is on, its explorer, and the quote tokens it accepts. */
  config: readConfig,

  /** The config if it has already been read, without waiting. */
  loadedConfig: (): ChainConfig | null => configLoaded,

  /**
   * One of the quote tokens by symbol, from the config when it has been read
   * and from the constants above when it has not.
   */
  quoteToken: (symbol: "MON" | "USDC"): QuoteToken => {
    const listed = configLoaded?.quoteTokens.find((token) => token.symbol === symbol);
    if (listed) return listed;
    return symbol === "MON"
      ? { address: MON_ADDRESS, symbol: "MON", decimals: 18, native: true }
      : {
          address: USDC_ADDRESS[configLoaded?.network ?? DEFAULT_NETWORK],
          symbol: "USDC",
          decimals: 6,
          native: false,
        };
  },

  /** Traders ranked by profit taken. `partial` when the walk came back short. */
  leaderboard: (limit = 20) =>
    api.get<{
      network: Network;
      partial: boolean;
      poolsRead: number;
      /** What the registry holds, so `poolsRead` can be read against something. */
      poolsTotal: number;
      traders: Trader[];
    }>(
      `/api/juno/leaderboard?limit=${limit}`,
    ),

  followStats: (wallet: string, viewer?: string | null) =>
    api.get<{
      wallet: string;
      followers: number;
      following: number;
      /** Null when there is no viewer — different from "does not follow". */
      viewerFollows: boolean | null;
      followingList: string[];
    }>(`/api/juno/follow?wallet=${wallet}${viewer ? `&viewer=${viewer}` : ""}`),

  setFollow: (follower: string, target: string, on: boolean) =>
    api.post<{ target: string; isFollowing: boolean; followers: number; following: number }>(
      "/api/juno/follow",
      { follower, target, following: on },
    ),

  /**
   * This wallet's relationship to one coin — watching, alert, plans.
   *
   * Postgres only. The list endpoints answer the same questions but hydrate
   * every pool from the chain to do it, which the coin screen cannot afford to
   * wait for just to decide what a button says.
   */
  saved: (wallet: string, token: string) =>
    api.get<{
      wallet: string;
      token: string;
      watching: boolean;
      alertPrice: number | null;
      /** The price when the alert was set — the direction is derived from it. */
      alertSetAtPrice: number | null;
      plans: Omit<Plan, "coin">[];
    }>(`/api/juno/saved?wallet=${wallet}&token=${token}`),

  watchlist: (wallet: string) =>
    api.get<{ wallet: string; items: WatchItem[]; missing: number }>(
      `/api/juno/watchlist?wallet=${wallet}`,
    ),

  setWatch: (input: {
    wallet: string;
    token: string;
    watch: boolean;
    alertPrice?: number;
    priceNow?: number;
  }) => api.post<{ token: string; watching: boolean }>("/api/juno/watchlist", input),

  plans: (wallet: string) =>
    api.get<{ wallet: string; plans: Plan[]; missing: number }>(`/api/juno/plans?wallet=${wallet}`),

  createPlan: (input: {
    wallet: string;
    token: string;
    amount: number;
    cadence: "daily" | "weekly" | "monthly";
    target?: number | null;
  }) => api.post<{ id: string }>("/api/juno/plans", input),

  /**
   * Called only after a swap confirms, so progress records real transactions.
   * The hash goes with it so the server can check the fill it is being told about.
   */
  recordContribution: (id: string, contributed: number, txHash: string) =>
    api.patch<{ plan: Plan }>("/api/juno/plans", { id, contributed, txHash }),

  setPlanActive: (id: string, active: boolean) =>
    api.patch<{ id: string; active: boolean }>("/api/juno/plans", { id, active }),

  removePlan: (id: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/api/juno/plans?id=${encodeURIComponent(id)}`),

  /**
   * The feed, optionally narrowed to wallets `following` follows.
   *
   * Filtered server-side: a client cannot know how many rows to ask for to be
   * sure the filter has something to work with.
   */
  feed: (limit = 40, following?: string) =>
    api.get<{
      network: Network;
      items: FeedItem[];
      /** The trade half was walked against a refusing endpoint — not the whole network. */
      tradesPartial: boolean;
      scope: "everyone" | "following";
      /** How many wallets the following feed covers. Null on the everyone feed. */
      followingCount: number | null;
    }>(
      `/api/juno/feed?limit=${limit}${following ? `&following=${following}` : ""}`,
    ),

  coins: (
    sort?: "marketCap" | "graduating",
    extra?: {
      /** Likes and comment counts too, and whether `viewer` liked each. */
      social?: boolean;
      viewer?: string | null;
      /** Each tracker's reference price — a Pyth or Tessera read per tracker. */
      nav?: boolean;
    },
  ) =>
    api.get<{
      network: Network;
      coins: Coin[];
      /** Registry rows the server could not price — the list is short by this many. */
      missing: number;
    }>(
      `/api/juno/coins?limit=40${sort ? `&sort=${sort}` : ""}${
        extra?.social ? `&social=1${extra.viewer ? `&viewer=${extra.viewer}` : ""}` : ""
      }${extra?.nav ? "&nav=1" : ""}`,
    ),

  /** Pre-IPO companies from Tessera, each with the Juno markets marked against it. */
  tessera: () =>
    api.get<{ network: Network; tokens: TesseraCompany[] }>("/api/juno/tessera"),

  /** Like counts for a page of coins, and whether `viewer` liked each. */
  likes: (coins: string[], viewer?: string | null) =>
    api.get<{ counts: Record<string, { likes: number; comments: number; viewerLiked: boolean | null }> }>(
      `/api/juno/likes?coins=${coins.join(",")}${viewer ? `&viewer=${viewer}` : ""}`,
    ),

  setLike: (input: { token: string; wallet: string; liked: boolean }) =>
    api.post<{ token: string; likes: number; liked: boolean }>("/api/juno/likes", input),

  coin: (token: string) =>
    api.get<{
      network: Network;
      coin: Coin;
      activity: Activity[];
      /** The swap walk was cut short — an empty `activity` is not "no trades". */
      activityPartial: boolean;
      holders: Holder[];
      /** The holder read was refused — an empty `holders` is not "no holders". */
      holdersUnreadable: boolean;
      /** How the holder list was derived. Null when it could not be. */
      holdersSource: string | null;
      /** How current the indexer is, when the holders came from it. */
      indexer?: { progressBlock: number; behind: number } | null;
      /** Null when the history could not be read at all — not "nobody traded". */
      crowd: Crowd | null;
      /** The transaction that launched this coin. */
      launchTx: string | null;
    }>(`/api/juno/coins/${token}`),

  portfolio: (wallet: string) => api.get<Portfolio>(`/api/juno/portfolio/${wallet}`),

  /** The wallet's notifications, newest first, and how many are new since its last visit. */
  notifications: (wallet: string) => api.get<Inbox>(`/api/juno/notifications?wallet=${wallet}`),
  /** The inbox was opened: everything in it is read. */
  markNotificationsSeen: (wallet: string) => api.post<{ seenAt: string }>("/api/juno/notifications", { wallet }),

  /** What Monad's transaction pool says about a hash (`txpool_statusByHash`); a local fork has no txpool methods. */
  txStatus: (hash: string) =>
    api.get<{ hash: string; where: string; supported: boolean; status?: string; reason?: string | null }>(`/api/juno/tx/status?hash=${hash}`),

  /** Monad's native staking, read live from Monad's network: epoch, proposer, the set, a wallet's delegations. */
  staking: (wallet?: string | null) => api.get<StakingView>(`/api/juno/staking${wallet ? `?wallet=${wallet}` : ""}`),

  /** Monad's own blocks moving through consensus, live from its WebSocket. */
  heartbeat: () => api.get<Heartbeat>("/api/juno/heartbeat"),

  /** The landing's live figures. Each part is null when its read failed. */
  stats: () => api.get<JunoStats>("/api/juno/stats"),

  /** What a confirmed transaction cost on Monad, and the same gas on Ethereum mainnet now. */
  txCost: (hash: string) => api.get<TxCost>(`/api/juno/tx/cost?hash=${hash}`),

  /** A creator's profile page: who they are, their follow graph, and every coin they launched. */
  profile: (wallet: string, viewer?: string | null) =>
    api.get<CreatorProfile>(`/api/juno/profiles/${wallet}${viewer ? `?viewer=${viewer}` : ""}`),

  /** Set a bio and link, signed by the wallet (see `detailsMessage` in lib/names). */
  saveProfileDetails: (input: { wallet: string; bio: string; link: string; issuedAt: string; signature: string }) =>
    api.post<{ wallet: string; bio: string; link: string }>(`/api/juno/profiles/${input.wallet}`, input),

  /** Comments on a coin, newest first. */
  comments: (token: string) =>
    api.get<{ comments: CoinComment[] }>(`/api/juno/comments?coin=${token}`),

  /**
   * Say something about a coin — optionally alongside a trade you just made.
   *
   * `side` and `txHash` are what turn a comment into an announcement: the
   * row then carries which way you went and the transaction that proves it,
   * so the claim is checkable rather than asserted.
   */
  addComment: (input: {
    token: string;
    wallet: string;
    body: string;
    side?: "buy" | "sell";
    txHash?: string;
  }) => api.post<{ comment: CoinComment }>("/api/juno/comments", input),

  /**
   * What this curve can absorb, and the largest trade inside an impact budget.
   *
   * `impact` is a ratio measured on curve movement with the fee excluded —
   * the fee does not grow with size, so including it would make the answer
   * mostly a constant.
   */
  depth: (token: string, side: "buy" | "sell" = "buy", impact?: number) =>
    api.get<{
      token: string;
      side: "buy" | "sell";
      spot: number;
      quoteSymbol: string;
      quoteUsdRate: number | null;
      max: number;
      points: DepthPoint[];
      suggestion:
        | (DepthPoint & { ceilingReached: boolean })
        | null;
    }>(
      `/api/juno/depth?token=${token}&side=${side}${impact ? `&impact=${impact}` : ""}`,
      60_000,
    ),

  createPost: (input: {
    author: string;
    body: string;
    token?: string | null;
    /** Set to reply. A comment is a post with a parent. */
    parentId?: string | null;
    mediaUrl?: string | null;
    mediaMime?: string | null;
  }) => api.post<{ post: { id: string } }>("/api/juno/posts", input),

  post: (id: string) =>
    api.get<{
      post: PostDetail;
      replies: PostDetail[];
      replyCount: number;
      coin: {
        address: string;
        name: string;
        symbol: string;
        priceUsd: number;
        marketCap: number;
        currency: string;
        changePct: number | null;
        progress: number;
        graduated: boolean;
      } | null;
    }>(`/api/juno/posts/${id}`),

  /**
   * Index a launch after its transaction has confirmed.
   *
   * The server re-reads the pool from chain and checks the creator and the
   * launch transaction before writing the row, so this cannot be used to
   * claim a pool that does not exist — or someone else's.
   */
  recordLaunch: (input: {
    token: string;
    name: string;
    symbol: string;
    format: "post" | "reel";
    curvePreset: string;
    /** The launch transaction's hash. */
    createTx: string;
    description?: string | null;
    mediaUrl?: string | null;
    posterUrl?: string | null;
    mediaMime?: string | null;
    mediaWidth?: number | null;
    mediaHeight?: number | null;
    navFeedId?: string | null;
  }) => api.post<{ pool: unknown }>("/api/juno/pools", input),

  /**
   * Pin a photo or video to IPFS. A video comes back with a poster frame.
   *
   * Multipart, so it bypasses the JSON helper. `file` is a web `File` in the
   * browser and the `{ uri, name, type }` shape React Native's fetch uploads
   * from on a phone.
   */
  upload: async (file: Blob | { uri: string; name: string; type: string }) => {
    const form = new FormData();
    form.append("file", file as Blob);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${API_URL}/api/juno/upload`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as
        | {
            uri: string;
            url: string;
            mimeType: string;
            posterUri?: string;
            posterUrl?: string;
            width: number | null;
            height: number | null;
            error?: string;
          }
        | null;
      if (!response.ok || !body) {
        throw new ApiError(body?.error ?? `Upload failed (${response.status})`, response.status);
      }
      return body;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError("The upload timed out. Try a shorter clip or a better connection.", 0);
      }
      throw new ApiError("Could not upload the file. Check your connection.", 0);
    } finally {
      clearTimeout(timer);
    }
  },

  /** Testnet MON for this wallet, sent from the server's faucet key. Testnet only. */
  faucet: (wallet: string) =>
    api.post<{ hash: string; amount: number; symbol: string }>("/api/juno/faucet", { wallet }, 90_000),

  /** Pin the token's metadata, which its `tokenURI` points at forever. */
  pinMetadata: (input: {
    name: string;
    symbol: string;
    description?: string;
    curvePreset: string;
    imageUrl?: string;
    mimeType?: string;
  }) => api.post<{ uri: string }>("/api/juno/metadata", input),

  buildSwap: (
    input: {
      token: string;
      owner: string;
      side: "buy" | "sell";
      /** What to spend (quote on a buy, tokens on a sell)… */
      amountIn?: number;
      /** …or, on a curve buy, exactly how many tokens to receive… */
      amountOut?: number;
      /** …or, on a sell, a share of the holding (0 < f ≤ 1), made exact by the server. */
      sellFraction?: number;
      slippageBps?: number;
    },
    /** Shorter than the default when the caller has a usable quote to fall back on. */
    timeoutMs?: number,
  ) => api.post<SwapBuild>("/api/juno/tx/swap", input, timeoutMs),

  buildLaunch: (input: {
    creator: string;
    name: string;
    symbol: string;
    preset: string;
    uri?: string;
    /** Quote token address; the zero address is native MON. */
    quoteToken?: string;
    initialMarketCap?: number;
    migrationMarketCap?: number;
    /** The creator's own first buy, in quote units, made in the launch transaction. */
    firstBuy?: number;
    /** Where the curve graduates. Uniswap v2 when omitted. */
    venue?: Venue;
  }) => api.post<LaunchBuild>("/api/juno/tx/launch", input),

  /** Pay the creator the trading fees their coin has accrued. Creator only. */
  claim: (input: { creator: string; token: string }) =>
    api.post<{ steps: UnsignedTransaction[] }>("/api/juno/tx/claim", input),

  /**
   * A limit order on a Kuru-graduated coin's book. `price` is MON per token,
   * `amount` tokens. The server snaps the price to the market's tick (never
   * worse) and deposits any shortfall into Kuru's MarginAccount first.
   */
  kuruOrder: (input: { token: string; owner: string; side: "buy" | "sell"; price: number; amount: number }) =>
    api.post<{
      steps: UnsignedTransaction[];
      market: string;
      price: number;
      amount: number;
      locks: { asset: "MON" | "token"; amount: number };
    }>("/api/juno/kuru/order", input),

  /** Open orders on a coin's Kuru market, and what Kuru holds for the wallet. `orders` null: no indexer to ask. */
  kuruOrders: (token: string, owner: string) =>
    api.get<{ market: string; orders: KuruOrder[] | null; balances: { mon: number; tokens: number } }>(
      `/api/juno/kuru/orders?token=${token}&owner=${owner}`,
    ),

  kuruCancel: (input: { token: string; owner: string; orderIds: string[] }) =>
    api.post<{ steps: UnsignedTransaction[] }>("/api/juno/kuru/cancel", input),

  /** Move fills and unused change from Kuru's MarginAccount back to the wallet. */
  kuruWithdraw: (input: { token: string; owner: string }) =>
    api.post<{ steps: UnsignedTransaction[] }>("/api/juno/kuru/withdraw", input),

  /** Perpl's perpetual markets, live. */
  perps: () =>
    api.get<{ exchange: string; collateral: { symbol: string; address: string; decimals: number }; markets: PerpMarket[] }>(
      "/api/juno/perps",
    ),
  /** A wallet on Perpl: account, collateral, positions. `accountId` null until it deposits. */
  perpAccount: (owner: string) => api.get<PerpAccount>(`/api/juno/perps/account?owner=${owner}`),
  perpDeposit: (input: { owner: string; amount: number }) =>
    api.post<{ steps: UnsignedTransaction[] }>("/api/juno/perps/deposit", input),
  perpWithdraw: (input: { owner: string; amount: number }) =>
    api.post<{ steps: UnsignedTransaction[] }>("/api/juno/perps/withdraw", input),
  /** Risk on Perpl: every market, and the owner's open positions. */
  perpRisk: (owner?: string | null) =>
    api.get<{ markets: MarketRisk[]; positions: PositionRisk[] | null; at: number }>(
      `/api/juno/perps/risk${owner ? `?owner=${owner}` : ""}`,
    ),
  /** Testnet AUSD from Agora's faucet: the one call to sign, or a 400 naming the rule that refuses it. */
  perpFaucet: (input: { owner: string }) =>
    api.post<{ steps: UnsignedTransaction[]; amount: number }>("/api/juno/perps/faucet", input),
  perpOpen: (input: { owner: string; perpId: number; side: "long" | "short"; collateral: number; leverage: number }) =>
    api.post<{ steps: UnsignedTransaction[]; size: number; mark: number; limitPrice: number }>("/api/juno/perps/open", input),
  perpClose: (input: { owner: string; perpId: number }) =>
    api.post<{ steps: UnsignedTransaction[] }>("/api/juno/perps/close", input),

  /** Move a filled curve into its venue — a Uniswap v2 pair or a Kuru market. Anyone may send it. */
  graduate: (input: { from: string; token: string }) =>
    api.post<{ steps: UnsignedTransaction[] }>("/api/juno/tx/graduate", input),

  /**
   * What this wallet holds of one token — the zero address for MON. `balance`
   * is null when the read failed: not zero, which would grey out a button over
   * a network hiccup.
   */
  balance: (wallet: string, token: string) =>
    api.get<{
      wallet: string;
      token: string;
      symbol: string;
      decimals: number;
      balance: number | null;
      /** Exact, in the smallest unit, as a decimal string. */
      raw: string | null;
    }>(`/api/juno/tx/balance?wallet=${wallet}&token=${token}`),

  /** Whether autopilot acts for this wallet, what its policy allows, and its last runs. */
  autopilot: (wallet: string) => api.get<AutopilotStatus>(`/api/juno/autopilot?wallet=${wallet}`),
  autopilotAction: (input: { action: "start" | "confirm" | "stop"; wallet: string } & AutopilotProof) =>
    api.post<AutopilotStatus>("/api/juno/autopilot", input, 60_000),
  /** Send server-built steps through autopilot (Privy pays the gas). Answers like `submit`, one result per step. */
  autopilotSend: (input: { wallet: string; steps: Array<{ to: string; data: Hex; value: Hex; label: string }> } & AutopilotProof) =>
    api.post<{ results: Array<SubmitResult & { via: "privy"; sponsored: boolean }> }>("/api/juno/autopilot/send", input, 120_000),

  /** Broadcast one signed transaction and wait for its receipt. */
  submit: (input: { signed: Hex }) =>
    // Submitting waits for the receipt, which is slower than a read.
    api.post<SubmitResult>("/api/juno/tx/submit", input, 90_000),

  /**
   * A URL the native `<Image>` can actually load, or null.
   *
   * Null is not just "absent" here — it also covers media the platform cannot
   * render, and the caller is expected to draw its own glyph instead. The
   * server falls back to an identicon encoded as `data:image/svg+xml`, which
   * renders fine in a browser and makes iOS throw "URI parsing error" out of
   * RCTImageManager, taking the whole screen down with a redbox. SVG data URIs
   * are therefore filtered out here rather than at each of the four call sites.
   */
  media: (url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith("data:image/svg")) return null;
    return url.startsWith("http") ? url : `${API_URL}${url}`;
  },

  /**
   * The best *still* image for a coin, for a list row or a thumbnail.
   *
   * Reel coins carry a video in `media.url` and a real poster frame beside it.
   * Handing the video to `<Image>` renders nothing at all, which is why the
   * market list showed a grey square for every reel while the coins with no
   * media at all were fine. A still context wants the poster; only if there
   * isn't one does the video's own url get a try, and a video url that is its
   * own poster is refused rather than silently failing to draw.
   */
  still: (media: {
    kind: "image" | "video";
    url: string;
    posterUrl?: string;
  }): string | null => {
    const poster = media.posterUrl && media.posterUrl !== media.url ? media.posterUrl : null;
    if (poster) return juno.media(poster);
    return media.kind === "video" ? null : juno.media(media.url);
  },

  /** A MonadVision link to a transaction, a wallet or a token. */
  explorer: (kind: "tx" | "address" | "token", id: string) => `${explorerBase()}/${kind}/${id}`,
  /**
   * Whether MonadVision can show what this server made. Not on a local fork:
   * its transactions, tokens and pairs exist on no public chain, and every
   * "View the transaction" there opened a page that said "not found".
   */
  explorable: () => !configLoaded?.localFork,
};
