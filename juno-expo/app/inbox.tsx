import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Identicon } from "../components/art";
import { Handle } from "../components/Handle";
import { Button, ChevronLeft, Placeholder, Skeleton } from "../components/kit";
import { juno, type InboxItem } from "../lib/api";
import { since } from "../lib/format";
import { money, tokens, useApi } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * Notifications: what happened to you since you last looked.
 *
 * Every row is something that already happened and can be checked: a fill
 * on your coin, a follow, a comment or a like, a price alert that crossed, a
 * plan that fell due. Opening the inbox reads it; the rows that were new
 * keep their dot until you leave.
 */
export default function InboxScreen() {
  const router = useRouter();
  const wallet = useWallet();
  const inbox = useApi(() => (wallet.address ? juno.notifications(wallet.address) : Promise.resolve(null)), [wallet.address]);
  // When this screen opened, what had already been seen: the rows newer than
  // it keep their dot for this visit even after the server marks them read.
  const [seenBefore, setSeenBefore] = useState<number | null>(null);
  const marked = useRef(false);

  useEffect(() => {
    if (!wallet.address || !inbox.data || marked.current) return;
    marked.current = true;
    setSeenBefore(inbox.data.seenAt ? Date.parse(inbox.data.seenAt) : Number.NEGATIVE_INFINITY);
    void juno.markNotificationsSeen(wallet.address).catch(() => undefined);
  }, [wallet.address, inbox.data]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/social" as never));
  const items = inbox.data?.items ?? [];

  return (
    <SafeAreaView edges={["top"]} style={styles.page}>
      <View style={styles.nav}>
        <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
          <ChevronLeft />
        </Pressable>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 36 }} />
      </View>

      {!wallet.ready ? null : !wallet.address ? (
        <Placeholder
          title="No wallet yet"
          detail="Notifications are about your coins, your followers and your alerts. Create a wallet to have some."
          action={<Button label="Create wallet" onPress={() => void wallet.connect().catch(() => undefined)} />}
        />
      ) : inbox.loading ? (
        <View style={{ padding: 16, gap: 18 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Skeleton h={40} w={40} round={20} />
              <Skeleton h={14} w="65%" />
            </View>
          ))}
        </View>
      ) : inbox.error ? (
        <Placeholder title="Could not load your notifications" detail={inbox.error} action={<Button label="Try again" onPress={inbox.refresh} />} />
      ) : items.length === 0 ? (
        <Placeholder
          title="Nothing yet"
          detail="When someone buys or sells your coin, follows you, comments or likes, it shows here, and so do your price alerts and due plans."
        />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={inbox.refreshing} onRefresh={inbox.refresh} tintColor={theme.colors.muted} />}
        >
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              fresh={seenBefore !== null && Date.parse(item.at) > seenBefore}
              onPress={() => {
                if (item.kind === "follow") router.push(`/trader/${item.actor}` as never);
                else router.push(`/coin/${item.token}`);
              }}
            />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ item, fresh, onPress }: { item: InboxItem; fresh: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={[styles.row, fresh ? styles.rowFresh : null]} testID="inbox-row">
      {"actor" in item ? <Identicon seed={item.actor} size={40} /> : <View style={styles.mark}><Text style={styles.markText}>{item.kind === "alert" ? "!" : "↻"}</Text></View>}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.line}>
          <Sentence item={item} />
        </Text>
        <Text style={styles.detail}>
          {since(item.at)} ago
          {item.kind === "comment" ? `  ·  “${item.body}”` : ""}
        </Text>
      </View>
      {fresh ? <View style={styles.dot} accessibilityLabel="New" /> : null}
    </Pressable>
  );
}

function Sentence({ item }: { item: InboxItem }) {
  const who = "actor" in item ? <Text style={styles.strong}><Handle wallet={item.actor} /></Text> : null;
  switch (item.kind) {
    case "trade":
      return (
        <>
          {who} {item.side === "buy" ? "bought" : "sold"} {tokens(item.base)} <Text style={styles.strong}>${item.symbol}</Text>{" "}
          for {tokens(item.quote)} {item.quoteSymbol}
        </>
      );
    case "follow":
      return <>{who} started following you</>;
    case "comment":
      return (
        <>
          {who} commented on <Text style={styles.strong}>${item.symbol}</Text>
        </>
      );
    case "like":
      return (
        <>
          {who} liked <Text style={styles.strong}>${item.symbol}</Text>
        </>
      );
    case "alert":
      return (
        <>
          <Text style={styles.strong}>${item.symbol}</Text> {item.direction === "up" ? "rose above" : "fell below"} your alert at{" "}
          {money(item.alertPrice, "USD", { compact: false })}: now {money(item.priceNow, "USD", { compact: false })}
        </>
      );
    case "plan":
      return (
        <>
          Your {item.cadence} buy of <Text style={styles.strong}>${item.symbol}</Text> is due
        </>
      );
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.surface },
  nav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8 },
  back: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
  title: { fontSize: theme.type.lead.size, fontWeight: "800", color: theme.colors.text },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.line,
  },
  rowFresh: { backgroundColor: theme.colors.limeSoft },
  line: { fontSize: theme.type.label.size, lineHeight: 20, color: theme.colors.text },
  strong: { fontWeight: "800" },
  detail: { fontSize: theme.type.caption.size, color: theme.colors.muted },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: theme.colors.heart },
  mark: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.ink, alignItems: "center", justifyContent: "center" },
  markText: { color: theme.colors.lime, fontWeight: "800", fontSize: 18 },
});
