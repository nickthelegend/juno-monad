import type { MarketRisk, PositionRisk } from "./perpl";

/**
 * Juno's Perpl bot — the decisions, kept pure so every rule is testable.
 *
 * Two jobs, either or both:
 *
 * - **Funding carry.** Perpl charges funding every ~43 minutes; when one side
 *   pays the other a lot, hold the side that is paid. Enter when a market's
 *   annualised funding passes `entryAnnualized`, on the receiving side (short
 *   when longs pay, long when shorts pay); leave when it falls back under
 *   `exitAnnualized` or turns against the position.
 * - **Guard.** For any open position — the bot's own or one a person opened —
 *   close it on a stop-loss or take-profit (as a fraction of the collateral it
 *   holds), or when the mark comes within `liquidationBuffer` of liquidation.
 *
 * Caps bound everything the bot can do: collateral per trade, positions held,
 * total notional, and a loss limit per day after which it opens nothing new.
 * The runner (`scripts/perpl-bot.ts`) reads the market and the account, calls
 * `decide`, and signs only what comes back.
 */

export type BotConfig = {
  /** Market symbols the bot may trade or guard, e.g. ["BTC", "ETH"]. Empty: every market. */
  markets: string[];
  /** Open carry positions. Off: guard only. */
  carry: boolean;
  /** Annualised funding (ratio) at which a carry position opens. */
  entryAnnualized: number;
  /** Annualised funding (ratio) under which a carry position closes. */
  exitAnnualized: number;
  /** AUSD collateral per new position. */
  collateralPerTrade: number;
  leverage: number;
  maxPositions: number;
  /** Total notional across open positions, USD. */
  maxNotional: number;
  /** Close when unrealised loss reaches this fraction of the position's collateral (0.5 = −50%). */
  stopLoss: number;
  /** Close when unrealised gain reaches this fraction of the collateral. */
  takeProfit: number;
  /** Close when the mark is within this fraction of the liquidation price (0.1 = 10% away). */
  liquidationBuffer: number;
  /** AUSD realised loss in a day after which no new positions open. */
  dailyLossLimit: number;
  /** Market volatility (annualised) above which no carry position opens. */
  maxVolatility: number;
};

export const DEFAULT_CONFIG: BotConfig = {
  markets: ["BTC", "ETH"],
  carry: true,
  entryAnnualized: 0.3,
  exitAnnualized: 0.1,
  collateralPerTrade: 25,
  leverage: 2,
  maxPositions: 2,
  maxNotional: 200,
  stopLoss: 0.25,
  takeProfit: 0.5,
  liquidationBuffer: 0.15,
  dailyLossLimit: 20,
  maxVolatility: 1.5,
};

export type BotPosition = PositionRisk & {
  /** AUSD the position holds (from the account), and its unrealised P&L. */
  collateral: number;
  pnl: number;
  /** Opened by the bot (its state file says so). Carry exits apply only to these; the guard applies to all. */
  ownedByBot: boolean;
};

export type BotInput = {
  markets: MarketRisk[];
  positions: BotPosition[];
  /** Free collateral on Perpl, AUSD. */
  freeCollateral: number;
  /** Realised loss so far today, AUSD (positive number). */
  lossToday: number;
  /** A halt switch: close nothing, open nothing, say so. */
  halted: boolean;
  /** Markets whose mark Perpl will not trade against right now (stale oracle). */
  staleMarkets?: Set<number>;
};

export type BotAction =
  | { kind: "open"; perpId: number; symbol: string; side: "long" | "short"; collateral: number; leverage: number; reason: string }
  | { kind: "close"; perpId: number; symbol: string; reason: string }
  | { kind: "hold"; reason: string };

const pct = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

export function decide(input: BotInput, config: BotConfig = DEFAULT_CONFIG): BotAction[] {
  if (input.halted) return [{ kind: "hold", reason: "halted: the kill switch is on" }];
  const wanted = (symbol: string) => config.markets.length === 0 || config.markets.includes(symbol);
  const actions: BotAction[] = [];
  const closing = new Set<number>();

  // Guard and carry exits first: what is already at risk comes before anything new.
  for (const position of input.positions) {
    if (!wanted(position.symbol)) continue;
    const market = input.markets.find((m) => m.id === position.perpId);
    const reason = exitReason(position, market, config);
    if (reason) {
      actions.push({ kind: "close", perpId: position.perpId, symbol: position.symbol, reason });
      closing.add(position.perpId);
    }
  }

  if (!config.carry) return actions.length ? actions : [{ kind: "hold", reason: "guarding: nothing to close" }];
  if (input.lossToday >= config.dailyLossLimit) {
    return [...actions, { kind: "hold", reason: `daily loss limit reached (${input.lossToday.toFixed(2)} of ${config.dailyLossLimit} AUSD): no new positions today` }];
  }

  const held = input.positions.filter((p) => !closing.has(p.perpId));
  let slots = config.maxPositions - held.length;
  let notional = held.reduce((sum, p) => sum + p.notional, 0);
  let free = input.freeCollateral;
  const candidates = input.markets
    .filter((m) => wanted(m.symbol) && !held.some((p) => p.perpId === m.id) && !closing.has(m.id))
    .filter((m) => Math.abs(m.fundingAnnualized) >= config.entryAnnualized)
    // Strongest carry first.
    .sort((a, b) => Math.abs(b.fundingAnnualized) - Math.abs(a.fundingAnnualized));

  for (const market of candidates) {
    if (slots <= 0) break;
    if (input.staleMarkets?.has(market.id)) continue;
    if (market.volatility !== null && market.volatility > config.maxVolatility) continue;
    const leverage = Math.min(config.leverage, market.maxLeverage);
    const size = config.collateralPerTrade * leverage;
    if (free < config.collateralPerTrade || notional + size > config.maxNotional) break;
    // Positive funding: longs pay shorts, so the carry is short.
    const side = market.fundingAnnualized > 0 ? "short" : "long";
    actions.push({
      kind: "open",
      perpId: market.id,
      symbol: market.symbol,
      side,
      collateral: config.collateralPerTrade,
      leverage,
      reason: `funding ${pct(market.fundingAnnualized)} a year ≥ ${pct(config.entryAnnualized)}: ${side} is paid`,
    });
    slots -= 1;
    notional += size;
    free -= config.collateralPerTrade;
  }

  return actions.length ? actions : [{ kind: "hold", reason: "nothing to do" }];
}

/** Why a position should close now, or null. */
export function exitReason(position: BotPosition, market: MarketRisk | undefined, config: BotConfig): string | null {
  const basis = Math.max(position.collateral, 1e-9);
  if (position.pnl <= -config.stopLoss * basis) return `stop-loss: ${position.pnl.toFixed(2)} AUSD on ${position.collateral.toFixed(2)}`;
  if (position.pnl >= config.takeProfit * basis) return `take-profit: +${position.pnl.toFixed(2)} AUSD on ${position.collateral.toFixed(2)}`;
  if (position.liquidationDistance !== null && Math.abs(position.liquidationDistance) <= config.liquidationBuffer) {
    return `liquidation ${pct(Math.abs(position.liquidationDistance))} away, inside the ${pct(config.liquidationBuffer)} buffer`;
  }
  if (config.carry && market && position.ownedByBot) {
    const paying = position.side === "long" ? market.fundingAnnualized > 0 : market.fundingAnnualized < 0;
    if (paying && Math.abs(market.fundingAnnualized) >= config.exitAnnualized) {
      return `funding turned: the ${position.side} now pays ${pct(Math.abs(market.fundingAnnualized))} a year`;
    }
    if (!paying && Math.abs(market.fundingAnnualized) < config.exitAnnualized) {
      return `funding faded to ${pct(Math.abs(market.fundingAnnualized))} a year, under ${pct(config.exitAnnualized)}`;
    }
  }
  return null;
}
