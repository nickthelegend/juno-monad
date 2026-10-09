import { StyleSheet, Text, View } from "react-native";

import { Button } from "./kit";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { theme } from "../theme";

/**
 * The feed's first-run tips: three, once per device.
 *
 * A first visit landed on a stream of photos with prices under them and no
 * word on what to do. The tips say it where it happens: the first one rings
 * the first post's Buy (the feed draws the ring), the second says what a new
 * wallet is given (the faucet's amount, read from the server), the third
 * points at Monad working (the rings and the live tape). The card never sits
 * on what it points at: under the header while it talks about a post, above
 * the tab bar while it talks about the top of the feed.
 */
export const COACH_STEPS = 3;

export function CoachMarks({
  step,
  onNext,
  onSkip,
  top,
  bottom,
}: {
  step: number;
  onNext: () => void;
  onSkip: () => void;
  /** Below the header, for the tips about a post (its Buy sits low on a phone). */
  top: number;
  /** Above the tab bar, for the tip about the rings and the tape at the top. */
  bottom: number;
}) {
  const faucet = useApi(() => api.get<{ amount: number }>("/api/juno/faucet").catch(() => null), []);
  const tips = [
    {
      title: "Every post is a market",
      body: "Tap Buy to own some of this post's coin. Its price moves on a bonding curve, and the creator earns the trading fees.",
    },
    {
      title: "Your first MON is on Juno",
      body: `A new wallet gets ${faucet.data ? `${faucet.data.amount} ` : ""}testnet MON from Juno's faucet, right in the buy sheet. Nothing to sign up for.`,
    },
    {
      title: "Monad, live",
      body: "Reels are the rings at the top. Trades appear in Live on Monad as their blocks are proposed and finalized, a few hundred milliseconds apart.",
    },
  ];
  const tip = tips[Math.min(step, tips.length - 1)];
  const last = step >= COACH_STEPS - 1;

  return (
    <View style={[styles.layer, step < 2 ? { top } : { bottom }, { pointerEvents: "box-none" }]}>
      <View style={styles.card} testID="coach-card" accessibilityRole="alert" accessibilityLabel={`${tip.title}. ${tip.body}`}>
        <View style={styles.head}>
          <Text style={styles.step}>{`${step + 1} of ${COACH_STEPS}`}</Text>
          <View style={styles.dots}>
            {tips.map((t, i) => (
              <View key={t.title} style={[styles.dot, i === step ? styles.dotOn : null]} />
            ))}
          </View>
        </View>
        <Text style={styles.title}>{tip.title}</Text>
        <Text style={styles.body}>{tip.body}</Text>
        <View style={styles.actions}>
          {last ? null : <Button label="Skip" variant="quiet" onPress={onSkip} />}
          <Button label={last ? "Start" : "Next"} variant="lime" onPress={onNext} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 12, right: 12, alignItems: "stretch" },
  card: {
    backgroundColor: theme.colors.ink,
    borderRadius: theme.radius.lg,
    padding: 16,
    gap: 6,
    boxShadow: "0 10px 30px rgba(18,21,14,0.28)",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  step: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", color: theme.colors.lime },
  dots: { flexDirection: "row", gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(243,247,238,0.3)" },
  dotOn: { backgroundColor: theme.colors.lime, width: 16 },
  title: { fontSize: 18, fontWeight: "800", color: theme.colors.onInk, letterSpacing: -0.3 },
  body: { fontSize: 14, lineHeight: 20, color: "rgba(243,247,238,0.82)" },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
});
