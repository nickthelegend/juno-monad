import {
  pgTable,
  text,
  varchar,
  integer,
  timestamp,
  pgEnum,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
  doublePrecision,
  bigint,
} from "drizzle-orm/pg-core";

/*
 * Conventions for every table below:
 *
 * - Addresses are stored EIP-55 checksummed (`viem`'s `getAddress`). One
 *   canonical spelling, so a lowercase address from a URL and a checksummed one
 *   from a receipt can never become two rows.
 * - `network` scopes every row to a chain (`monad-testnet` or `monad`): a
 *   testnet rehearsal must never surface in a mainnet feed.
 */

/* ==================================================================
   Juno — the index of pools this app launched.
   ==================================================================
   The launchpad contract is the source of truth for every number that
   moves: price, reserves, curve progress, graduation. None of that is
   duplicated here, because a cached copy of a live market is a cache
   that is always wrong.

   What the chain does not hold is what a creator typed when they
   launched a post — the caption, the media, whether it is a reel. That
   is what this table holds: identity and provenance, not state.
   ================================================================== */
export const junoCoinFormatEnum = pgEnum("juno_coin_format", ["post", "reel"]);

/** How often a recurring buy comes due. */
export const junoPlanCadenceEnum = pgEnum("juno_plan_cadence", ["daily", "weekly", "monthly"]);

export const junoPools = pgTable(
  "juno_pools",
  {
    /** The ERC-20 address. Canonical id everywhere in the app and in URLs. */
    token: varchar("token", { length: 42 }).primaryKey(),
    /** The launchpad contract that holds this token's curve. */
    launchpad: varchar("launchpad", { length: 42 }).notNull(),
    /** The AMM pair the curve graduates into, fixed at launch. Null if none was configured. */
    pair: varchar("pair", { length: 42 }),
    /** The quote token; the zero address means native MON. */
    quoteToken: varchar("quote_token", { length: 42 }).notNull(),
    creatorWallet: varchar("creator_wallet", { length: 42 }).notNull(),

    /** Which chain this pool lives on — testnet rows must not leak to mainnet. */
    network: varchar("network", { length: 16 }).notNull(),

    name: text("name").notNull(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    description: text("description"),
    format: junoCoinFormatEnum("format").notNull().default("post"),
    /** Which `lib/juno/curves.ts` preset it was launched with. */
    curvePreset: varchar("curve_preset", { length: 32 }).notNull(),

    mediaUrl: text("media_url"),
    posterUrl: text("poster_url"),
    /** What kind of file the media is. URLs on IPFS carry no extension, so
        image-vs-video cannot be sniffed from the address. */
    mediaMime: text("media_mime"),
    mediaWidth: integer("media_width"),
    mediaHeight: integer("media_height"),

    /**
     * What this curve is marked against: a Pyth feed id, or `tessera:T-OpenAI`
     * for a pre-IPO name Pyth has no feed for.
     */
    navFeedId: text("nav_feed_id"),

    /**
     * How many units of the reference one token stands for.
     *
     * A curve token costs a hundredth of a cent and a share of NVDA costs
     * $224, so comparing the two directly reports every tracker as "-100%,
     * outside the band" — a true subtraction of two numbers that are not the
     * same kind of thing.
     *
     * Set at launch from the reference's own price, so a tracker starts at
     * parity by construction and the band then measures what it is actually
     * for: drift *relative to* the underlying. Null for coins that track
     * nothing, which yields no deviation rather than a fabricated one.
     */
    navUnitsPerToken: doublePrecision("nav_units_per_token"),

    /** The launch transaction — the receipt a judge clicks. */
    createTx: varchar("create_tx", { length: 66 }).notNull(),
    createBlock: bigint("create_block", { mode: "number" }),
    /**
     * Whether the coin appears in public lists — the feed, reels, Trade.
     *
     * A launch is permanent on-chain and cannot be undone, but a rehearsal
     * or a test launch should not be the first thing a visitor scrolls past.
     * Unlisting hides it from browsing and nothing else: its page still
     * opens, holders still see it in their portfolio, the indexer still
     * reads it. Nothing is deleted.
     */
    listed: boolean("listed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("juno_pools_network_created_idx").on(table.network, table.createdAt),
    index("juno_pools_creator_idx").on(table.creatorWallet),
  ],
);

/**
 * Creator posts — the non-trade half of the social feed.
 *
 * Juno's feed mixes two kinds of item. Trades are read from the chain; a post
 * is something a person wrote, which has nowhere else to live. A post may
 * reference a coin (`token`) or stand alone, so a creator can talk about a
 * launch without every message having to be one.
 */
export const junoPosts = pgTable(
  "juno_posts",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    authorWallet: varchar("author_wallet", { length: 42 }).notNull(),
    network: varchar("network", { length: 16 }).notNull(),

    body: text("body").notNull(),
    /** Optional: the coin this post is about. */
    token: varchar("token", { length: 42 }),

    mediaUrl: text("media_url"),
    mediaMime: text("media_mime"),

    /**
     * The post this one replies to.
     *
     * A comment is a post with a parent rather than its own table: it has the
     * same author, body, timestamp and network scoping, and giving it a second
     * schema would mean two of every query. Null for a top-level post, which is
     * also what the feed filters on.
     */
    parentId: varchar("parent_id", { length: 32 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("juno_posts_network_created_idx").on(table.network, table.createdAt),
    index("juno_posts_author_idx").on(table.authorWallet),
    index("juno_posts_token_idx").on(table.token),
    index("juno_posts_parent_idx").on(table.parentId),
  ],
);

/**
 * Every `Trade` the launchpad has emitted, as read from its logs.
 *
 * The chain is the source of truth; this is a record of what was already read
 * from it, keyed by the log that proves it. Nothing here is computed — every
 * column is something the event said, scaled to display units. A chart, a
 * portfolio, a leaderboard and the feed all read the same rows instead of each
 * walking the chain.
 */
export const junoSwaps = pgTable(
  "juno_swaps",
  {
    /** `${txHash}:${logIndex}` — one transaction can hold several fills. */
    id: varchar("id", { length: 80 }).primaryKey(),
    txHash: varchar("tx_hash", { length: 66 }).notNull(),
    logIndex: integer("log_index").notNull(),
    token: varchar("token", { length: 42 }).notNull(),
    network: varchar("network", { length: 16 }).notNull(),
    side: varchar("side", { length: 4 }).notNull(),
    /** Tokens that changed hands, in UI units. */
    baseAmount: doublePrecision("base_amount").notNull(),
    /** What the trader paid (buy, fee included) or received (sell, fee deducted). */
    quoteAmount: doublePrecision("quote_amount").notNull(),
    fee: doublePrecision("fee").notNull().default(0),
    /** Realised price of this fill, in quote per token. */
    price: doublePrecision("price").notNull(),
    /** Whose position changed: the buyer's recipient, or the seller. */
    trader: varchar("trader", { length: 42 }).notNull(),
    blockNumber: bigint("block_number", { mode: "number" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("juno_swaps_token_block_idx").on(table.token, table.blockNumber),
    index("juno_swaps_trader_idx").on(table.network, table.trader),
    uniqueIndex("juno_swaps_tx_log_idx").on(table.txHash, table.logIndex),
  ],
);

/**
 * How far the launchpad's logs have been read.
 *
 * One cursor per launchpad, not per pool: every pool's trades come out of the
 * same contract's event log, so a single forward scan keeps them all current.
 */
export const junoLogCursor = pgTable("juno_log_cursor", {
  /** `${network}:${launchpad}`. */
  id: varchar("id", { length: 64 }).primaryKey(),
  /** The last block whose logs are fully recorded. */
  block: bigint("block", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Who follows whom.
 *
 * A follow is the smallest primitive that turns a launchpad with a feed into a
 * social trading app: every feature above it — a filtered feed, a copied
 * position, a follower count — is a query against this table. The primary key
 * is the pair, so following twice is a no-op rather than a duplicate row.
 */
export const junoFollows = pgTable(
  "juno_follows",
  {
    followerWallet: varchar("follower_wallet", { length: 42 }).notNull(),
    targetWallet: varchar("target_wallet", { length: 42 }).notNull(),
    network: varchar("network", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.followerWallet, table.targetWallet, table.network] }),
    index("juno_follows_target_idx").on(table.network, table.targetWallet),
    index("juno_follows_follower_idx").on(table.network, table.followerWallet),
  ],
);

/**
 * Coins a wallet is keeping an eye on.
 *
 * Separate from a follow because the objects are different: you follow a
 * person for their decisions and watch a coin for its price. A watch has a
 * price alert; a follow does not.
 */
export const junoWatchlist = pgTable(
  "juno_watchlist",
  {
    wallet: varchar("wallet", { length: 42 }).notNull(),
    token: varchar("token", { length: 42 }).notNull(),
    network: varchar("network", { length: 16 }).notNull(),

    /**
     * Alert when the coin's price crosses this, in the coin's own quote terms.
     *
     * Null means watching without an alert, which is the common case. The
     * direction is not stored: it is derived from the price when the alert was
     * set, so "tell me at 0.0005" means up if it is below that now and down if
     * it is above.
     */
    alertPrice: doublePrecision("alert_price"),
    /** The price when the alert was set, so the crossing direction is knowable. */
    alertSetAtPrice: doublePrecision("alert_set_at_price"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.wallet, table.token, table.network] }),
    index("juno_watchlist_wallet_idx").on(table.network, table.wallet),
    index("juno_watchlist_token_idx").on(table.network, table.token),
  ],
);

/**
 * A recurring buy someone has committed to.
 *
 * Deliberately not a bot. Executing a swap on someone's behalf needs a session
 * key with spending authority, which this project does not have and should not
 * fake — so the plan stores the *intent* (what, how much, how often) and the
 * app tells you when it is due. The buy itself is the same server-built,
 * device-signed transaction as any other.
 *
 * `contributed` and `fills` are written after a swap confirms, so the progress
 * bar is a record of real transactions rather than of intentions.
 */
export const junoPlans = pgTable(
  "juno_plans",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    wallet: varchar("wallet", { length: 42 }).notNull(),
    token: varchar("token", { length: 42 }).notNull(),
    network: varchar("network", { length: 16 }).notNull(),

    /** Quote-token amount per contribution. */
    amount: doublePrecision("amount").notNull(),
    /** How often it comes due. */
    cadence: junoPlanCadenceEnum("cadence").notNull(),
    /** Optional target, so progress means something. Quote terms. */
    target: doublePrecision("target"),

    /** Sum of contributions that actually confirmed on chain. */
    contributed: doublePrecision("contributed").notNull().default(0),
    /** How many confirmed. */
    fills: integer("fills").notNull().default(0),
    lastFilledAt: timestamp("last_filled_at", { withTimezone: true }),

    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("juno_plans_wallet_idx").on(table.network, table.wallet),
    index("juno_plans_token_idx").on(table.network, table.token),
  ],
);
