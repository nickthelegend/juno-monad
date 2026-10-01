import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { type Coin } from "../lib/api";
import { shortAddress } from "../lib/names";
import { useLive } from "../lib/live";
import { theme } from "../theme";
import { StageDots } from "./Finality";

/**
 * "Live on Monad": the last few trades against Juno's launchpad, each with the
 * stage its block has reached. A buy appears the moment its block is proposed
 * and its dots fill as the chain votes and finalizes it, a few hundred
 * milliseconds apart.
 *
 * Hidden entirely when the server is not listening or nothing has happened
 * since it started — an empty "live" panel is a claim of liveness with no
 * evidence behind it.
 */
export function LiveTape({ coins }: { coins: Coin[] | null | undefined }) {
  const router = useRouter();
  // The server follows the chain's own stream — Monad's, or on a local fork
  // the fork node's — so the tape is live either way.
  const live = useLive({}, { intervalMs: 1_000 });
  const symbols = useMemo(() => {
    const map = new Map<string, Coin>();
    for (const coin of coins ?? []) map.set(coin.address.toLowerCase(), coin);
    return map;
  }, [coins]);

  const trades = (live?.events ?? []).filter((event) => event.kind === "trade").slice(0, 3);
  if (!live?.connected || trades.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.pulse} />
        <Text style={styles.title}>{live.staged === false ? "Live on the local fork" : "Live on Monad"}</Text>
      </View>
      {trades.map((event) => {
        const coin = symbols.get(event.token.toLowerCase());
        const base = event.baseAmount ? Number(event.baseAmount) / 1e18 : null;
        return (
          <Pressable
            key={event.id}
            style={styles.row}
            onPress={() => router.push(`/coin/${event.token}`)}
            accessibilityRole="button"
          >
            <Text style={styles.who} numberOfLines={1}>
              <Text style={event.side === "buy" ? styles.buy : styles.sell}>
                {event.side === "buy" ? "Bought" : "Sold"}
              </Text>
              {` ${base !== null ? compact(base) : ""} ${coin ? `$${coin.symbol}` : event.symbol ? `$${event.symbol}` : shortAddress(event.token)}`}
              <Text style={styles.by}>{` · ${event.trader ? shortAddress(event.trader) : ""}`}</Text>
            </Text>
            <StageDots event={event} compact staged={live.staged !== false} />
          </Pressable>
        );
      })}
    </View>
  );
}

function compact(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toFixed(value >= 1 ? 0 : 4);
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: theme.space(4),
    marginBottom: theme.space(3),
    padding: theme.space(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    gap: theme.space(2),
    ...theme.shadow.card,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  pulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.pos },
  title: { fontSize: theme.type.label.size, fontWeight: "800", color: theme.colors.text },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space(2) },
  who: { flex: 1, fontSize: theme.type.caption.size, color: theme.colors.text, fontWeight: "600" },
  buy: { color: theme.colors.pos, fontWeight: "800" },
  sell: { color: theme.colors.neg, fontWeight: "800" },
  by: { color: theme.colors.faint, fontWeight: "500" },
});
