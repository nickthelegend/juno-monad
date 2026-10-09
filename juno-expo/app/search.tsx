import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CoinArt, Identicon } from "../components/art";
import { juno, type Coin } from "../lib/api";
import { searchMarkets } from "../lib/discover";
import { loadMarkets } from "../lib/markets";
import { money, useApi } from "../lib/useApi";
import { theme } from "../theme";

/**
 * Search: a coin by ticker, name or address, or a creator by handle.
 *
 * With fourteen markets a scroll found anything; with more, a judge looking
 * for "$KURU" or a friend's profile had no way in but the feed. This reads
 * the same market list the feed does and matches as you type, nothing sent
 * anywhere new.
 */
export default function SearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const markets = useApi(() => loadMarkets(), []);
  const all = useMemo<Coin[]>(
    () => (markets.data ? [...markets.data.posts, ...markets.data.preipo, ...markets.data.stocks] : []),
    [markets.data],
  );
  const hits = useMemo(() => searchMarkets(query, all), [query, all]);

  return (
    <SafeAreaView edges={["top"]} style={styles.page}>
      <View style={styles.bar}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search coins and creators"
          placeholderTextColor={theme.colors.faint}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="Search coins and creators"
        />
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.cancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {query.trim().length < 2 ? (
          <Text style={styles.hint}>{markets.loading ? "Reading the markets…" : `${all.length} markets. Type a ticker, a name or a handle.`}</Text>
        ) : hits.length === 0 ? (
          <Text style={styles.hint}>Nothing matches “{query.trim()}”.</Text>
        ) : (
          hits.map((hit) =>
            hit.kind === "coin" ? (
              <Pressable key={hit.coin.address} style={styles.row} onPress={() => router.push(`/coin/${hit.coin.address}`)} accessibilityRole="link" testID="search-coin">
                <CoinArt uri={juno.still(hit.coin.media)} seed={hit.coin.address} size={40} radius={12} />
                <View style={styles.rowText}>
                  <Text style={styles.title} numberOfLines={1}>
                    ${hit.coin.symbol}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {hit.coin.name}
                  </Text>
                </View>
                <Text style={styles.figure}>{money(hit.coin.marketCap, hit.coin.marketCapCurrency)}</Text>
              </Pressable>
            ) : (
              <Pressable key={hit.wallet} style={styles.row} onPress={() => router.push(`/trader/${hit.wallet}` as never)} accessibilityRole="link" testID="search-creator">
                <Identicon seed={hit.wallet} size={40} />
                <View style={styles.rowText}>
                  <Text style={styles.title} numberOfLines={1}>
                    {hit.name}
                  </Text>
                  <Text style={styles.sub}>
                    {hit.posts} {hit.posts === 1 ? "post" : "posts"}
                  </Text>
                </View>
              </Pressable>
            ),
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.bg },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.surface,
    fontSize: 16,
    color: theme.colors.text,
  },
  cancel: { paddingHorizontal: 6, paddingVertical: 8 },
  cancelText: { fontSize: 15, fontWeight: "700", color: theme.colors.text },
  list: { paddingHorizontal: 16, paddingBottom: 120, gap: 6 },
  hint: { fontSize: 14, color: theme.colors.muted, paddingVertical: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface },
  rowText: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: "800", color: theme.colors.text },
  sub: { fontSize: 13, color: theme.colors.muted },
  figure: { fontSize: 14, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
});
