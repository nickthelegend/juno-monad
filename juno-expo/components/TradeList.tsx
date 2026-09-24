import styled from "styled-components/native";

import type { Position } from "../lib/api";
import { money, tokens } from "../lib/useApi";
import { Body, Caption, Card, Label, Mono, Row } from "./kit";

/**
 * A wallet's trades across every coin it holds, newest first.
 *
 * Read from the positions the portfolio endpoint returns, so the list and the
 * "Trades" count above it come from the same rows. Used for your own Activity
 * tab and for someone else's trader page — a public wallet's fills are
 * public, and "what did they actually do" is the question after "what do they
 * hold".
 */
export function TradeList({ positions, limit = 20 }: { positions: Position[]; limit?: number }) {
  const trades = positions
    .flatMap((p) => p.trades.map((t) => ({ ...t, name: p.name, currency: p.currency })))
    .sort((a, b) => Date.parse(b.t) - Date.parse(a.t));

  if (trades.length === 0) {
    return (
      <Card>
        <Body muted>No trades yet.</Body>
      </Card>
    );
  }

  return (
    <>
      {trades.slice(0, limit).map((trade, i) => (
        <Card key={`${trade.t}-${i}`}>
          <Row gap={10}>
            <Side $buy={trade.side === "buy"}>{trade.side}</Side>
            <Label numberOfLines={1} style={{ flex: 1 }}>
              {trade.name}
            </Label>
            <Mono muted>{tokens(trade.base)}</Mono>
          </Row>
          {/* What changed hands, and the price that works out to. Not the
              trade's `price`: that is the mark after it, which on a large
              curve buy is far above what the buyer actually paid. */}
          <Caption style={{ marginTop: 6 }}>
            {trade.quote !== undefined && trade.base > 0
              ? `${trade.side === "buy" ? "Paid" : "Received"} ${money(trade.quote, trade.currency, { compact: false })} · ${money(trade.quote / trade.base, trade.currency, { compact: false })} each · `
              : ""}
            {new Date(trade.t).toLocaleString()}
          </Caption>
        </Card>
      ))}
      {trades.length > limit ? <Caption>The latest {limit} of {trades.length}.</Caption> : null}
    </>
  );
}

const Side = styled.Text<{ $buy: boolean }>`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 700;
  text-transform: capitalize;
  width: 38px;
  color: ${(p) => (p.$buy ? p.theme.colors.pos : p.theme.colors.neg)};
`;
