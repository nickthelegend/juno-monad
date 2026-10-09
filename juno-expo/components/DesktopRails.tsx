import { usePathname, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { CoinArt } from "./art";
import { Heartbeat } from "./Heartbeat";
import { LiveTape } from "./LiveTape";
import { juno, type Coin } from "../lib/api";
import { newestOf, trendingOf } from "../lib/discover";
import { loadMarkets } from "../lib/markets";
import { money, useApi } from "../lib/useApi";
import { theme } from "../theme";

/**
 * The laptop layout: the phone column, with the market around it.
 *
 * At 1440 px the app was a 480 px column on empty sage, a third of a judge's
 * screen. Wide windows now get two rails beside the column:
 * - left: Monad live (the commit-state strip, the trades as they land, and
 *   the network figures the landing shows);
 * - right: what is moving (trending by 24 h volume) and what just launched.
 *
 * Both read the same endpoints the screens do, and every row opens the coin
 * in the column. Nothing in the column changes: phones and narrow windows
 * see exactly what they saw. The landing keeps the window to itself, since it
 * is already the live panel.
 */

/** The column (480) plus two rails (300) and their gaps. */
export const RAILS_MIN_WIDTH = 1180;

export function LeftRail() {
  const pathname = usePathname();
  const markets = useApi(() => loadMarkets(), []);
  const stats = useApi(() => juno.stats(), []);
  const { refresh } = stats;
  useEffect(() => {
    const timer = setInterval(refresh, 2_500);
    return () => clearInterval(timer);
  }, [refresh]);
  if (pathname === "/") return <View style={styles.rail} />;
  const s = stats.data;

  return (
    <ScrollView style={styles.rail} contentContainerStyle={styles.railBody} testID="rail-left" showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>{s?.localFork ? "Live · local fork of Monad testnet" : "Live on Monad"}</Text>
      {s ? (
        <View style={styles.card}>
          <View style={styles.figures}>
            {s.coins !== null ? <Figure value={String(s.coins)} label="markets" /> : null}
            {s.trades24h !== null ? <Figure value={String(s.trades24h)} label="trades, 24h" testID="rail-trades" /> : null}
            {s.confirmation ? <Figure value={`${s.confirmation.medianMs} ms`} label="to confirm" /> : null}
          </View>
          {s.block ? (
            <Text style={styles.caption} testID="rail-block">
              Block #{s.block.number.toLocaleString("en-US")}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View style={styles.card}>
        <Heartbeat />
      </View>
      {/* Renders nothing until the server has seen a trade. */}
      <View style={styles.tape}>
        <LiveTape coins={markets.data?.posts} />
      </View>
    </ScrollView>
  );
}

export function RightRail() {
  const router = useRouter();
  const pathname = usePathname();
  const markets = useApi(() => loadMarkets(), []);
  const record = useApi(() => juno.feed(100).catch(() => null), []);
  const posts = markets.data?.posts ?? [];

  const trending = useMemo(
    () =>
      trendingOf(
        posts,
        (record.data?.items ?? []).flatMap((item) =>
          item.kind === "trade" ? [{ coin: item.coin.address, timestamp: item.timestamp, valueUsd: item.valueUsd }] : [],
        ),
      ),
    [posts, record.data?.items],
  );
  const fresh = useMemo(() => newestOf(posts), [posts]);
  if (pathname === "/") return <View style={styles.rail} />;

  return (
    <ScrollView style={styles.rail} contentContainerStyle={styles.railBody} testID="rail-right" showsVerticalScrollIndicator={false}>
      <Text style={styles.kicker}>Most traded · 24h</Text>
      <View style={styles.card}>
        {markets.loading || record.loading ? (
          <Text style={styles.caption}>Reading the markets…</Text>
        ) : trending.length === 0 ? (
          <Text style={styles.caption}>Nothing has traded in the last day.</Text>
        ) : (
          trending.map(({ coin, trades, valueUsd }, i) => (
            <CoinRow
              key={coin.address}
              coin={coin}
              rank={i + 1}
              figure={`${trades} ${trades === 1 ? "trade" : "trades"} · ${money(valueUsd, "USD")}`}
              onPress={() => router.push(`/coin/${coin.address}`)}
            />
          ))
        )}
      </View>
      <Text style={styles.kicker}>Just launched</Text>
      <View style={styles.card}>
        {fresh.map((coin) => (
          <CoinRow key={coin.address} coin={coin} figure={`${money(coin.marketCap, coin.marketCapCurrency)} mcap`} onPress={() => router.push(`/coin/${coin.address}`)} />
        ))}
      </View>
    </ScrollView>
  );
}

function Figure({ value, label, testID }: { value: string; label: string; testID?: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue} testID={testID}>
        {value}
      </Text>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

function CoinRow({ coin, rank, figure, onPress }: { coin: Coin; rank?: number; figure: string; onPress: () => void }) {
  const change = coin.marketCapChangePct;
  return (
    <Pressable onPress={onPress} style={styles.row} accessibilityRole="link" accessibilityLabel={`${coin.name}, $${coin.symbol}`} testID="rail-coin">
      {rank !== undefined ? <Text style={styles.rank}>{rank}</Text> : null}
      <CoinArt uri={juno.still(coin.media)} seed={coin.address} size={34} radius={10} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.symbol} numberOfLines={1}>
          ${coin.symbol}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          {figure}
        </Text>
      </View>
      {change !== null ? (
        <Text style={[styles.change, { color: change >= 0 ? theme.colors.pos : theme.colors.neg }]}>
          {change >= 0 ? "+" : ""}
          {(change * 100).toFixed(1)}%
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { width: 300, flexGrow: 0, flexShrink: 0 },
  railBody: { paddingVertical: 24, gap: 10 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", color: theme.colors.muted, marginTop: 6, paddingHorizontal: 4 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 14,
    gap: 10,
    ...theme.shadow.card,
  },
  tape: { marginHorizontal: -theme.space(4) },
  figures: { flexDirection: "row", gap: 12 },
  figure: { flex: 1, gap: 2 },
  figureValue: { fontSize: 18, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  caption: { fontSize: 12, color: theme.colors.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  rank: { width: 14, fontSize: 12, fontWeight: "800", color: theme.colors.faint, textAlign: "center" },
  symbol: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
  change: { fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
