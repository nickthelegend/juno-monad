import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { juno, type Heartbeat as HeartbeatData } from "../lib/api";
import { useApi } from "../lib/useApi";
import { theme } from "../theme";

/**
 * Monad's heartbeat: its real blocks moving through consensus as they do.
 *
 * Each chip is a block from Monad's own network, read live from its
 * WebSocket (`monadNewHeads`). It turns from Proposed (grey) to Voted (blue)
 * to Finalized (green) to Verified (a check), and the medians say how long
 * each stage took. Nothing on another EVM chain looks like this. When this
 * app's own trades run on a local fork, the caption says so: the strip is the
 * network, not the fork.
 */
export function Heartbeat({ compact = false }: { compact?: boolean }) {
  const beat = useApi(() => juno.heartbeat(), []);
  const { refresh } = beat;
  useEffect(() => {
    const timer = setInterval(refresh, 1_000);
    return () => clearInterval(timer);
  }, [refresh]);
  const data = beat.data;
  if (!data || (data.blocks.length === 0 && !data.error)) return compact ? null : <View style={styles.wrap} />;

  return (
    <View style={styles.wrap} accessibilityLabel="Monad heartbeat" testID="heartbeat">
      <View style={styles.head}>
        <View style={[styles.liveDot, { backgroundColor: data.connected ? theme.colors.pos : theme.colors.faint }]} />
        <Text style={styles.title}>{data.network === "monad" ? "Monad" : "Monad testnet"} · live</Text>
        <View style={{ flex: 1 }} />
        {data.blockMs !== null ? (
          <Text style={styles.blockMs} testID="heartbeat-block-ms">
            {data.blockMs} ms blocks
          </Text>
        ) : null}
      </View>

      {data.blocks.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {data.blocks.slice(0, compact ? 6 : 10).map((block) => (
            <Chip key={block.number} block={block} />
          ))}
        </ScrollView>
      ) : null}

      <Text style={styles.medians} testID="heartbeat-medians">
        {[
          data.votedMs !== null ? `voted ${data.votedMs} ms` : null,
          data.finalizedMs !== null ? `final ${data.finalizedMs} ms` : null,
          data.verifiedMs !== null ? `verified ${(data.verifiedMs / 1000).toFixed(1)} s` : null,
        ]
          .filter(Boolean)
          .join("  ·  ") || "waiting for the next block…"}
      </Text>
      {/* Where the strip comes from, as a chip rather than a sentence; an
          error is the one thing that still gets words. */}
      {data.error ? (
        <Text style={styles.caption}>{data.error}</Text>
      ) : data.appOnFork ? (
        <View style={styles.source}>
          <Text style={styles.sourceText}>live from {data.network === "monad" ? "Monad" : "Monad testnet"} · trades here: local fork</Text>
        </View>
      ) : null}
    </View>
  );
}

const STATE_COLOR: Record<HeartbeatData["blocks"][number]["state"], string> = {
  Proposed: theme.colors.lineStrong,
  Voted: theme.colors.focus,
  Finalized: theme.colors.pos,
  Verified: theme.colors.pos,
};

function Chip({ block }: { block: HeartbeatData["blocks"][number] }) {
  return (
    <View style={styles.chip} accessibilityLabel={`Block ${block.number}, ${block.state}`}>
      <View style={[styles.chipDot, { backgroundColor: STATE_COLOR[block.state] }]}>
        {block.state === "Verified" ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <Text style={styles.chipNumber}>…{String(block.number).slice(-4)}</Text>
      <Text style={styles.chipState}>{block.state}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  title: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", color: theme.colors.muted },
  blockMs: { fontSize: 12, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  chips: { gap: 6 },
  source: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.colors.surfaceAlt },
  sourceText: { fontSize: 11, fontWeight: "700", color: theme.colors.muted },
  chip: {
    alignItems: "center",
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
    minWidth: 62,
  },
  chipDot: { width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  check: { fontSize: 9, fontWeight: "900", color: "#FFFFFF" },
  chipNumber: { fontSize: 11, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  chipState: { fontSize: 9, fontWeight: "700", color: theme.colors.muted },
  medians: { fontSize: 13, fontWeight: "700", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  caption: { fontSize: 11, lineHeight: 15, color: theme.colors.muted },
});
