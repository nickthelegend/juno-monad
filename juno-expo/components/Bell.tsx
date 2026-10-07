import { useRouter } from "expo-router";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { useRefreshOnFocus } from "../lib/focus";
import { juno } from "../lib/api";
import { useApi } from "../lib/useApi";
import { theme } from "../theme";

/**
 * The feed's bell: how many things happened to you since you last looked.
 *
 * Read from the same inbox the screen shows, every thirty seconds and when
 * the feed comes back into view. Nothing new, no badge.
 */
export function Bell({ wallet }: { wallet: string }) {
  const router = useRouter();
  const inbox = useApi(() => juno.notifications(wallet), [wallet]);
  const { refresh } = inbox;
  useRefreshOnFocus(refresh, 5_000);
  useEffect(() => {
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  const unread = inbox.data?.unread ?? 0;

  return (
    <Pressable
      onPress={() => router.push("/inbox" as never)}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? `Notifications, ${unread} new` : "Notifications"}
      style={styles.button}
    >
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path
          d="M18 9.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 15.5 18 9.5ZM10 20.5a2.2 2.2 0 0 0 4 0"
          stroke={theme.colors.text}
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
      {unread > 0 ? (
        <View style={styles.badge} testID="bell-badge">
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", marginRight: 6 },
  badge: {
    position: "absolute",
    top: 2,
    right: 0,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: theme.colors.heart,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: theme.colors.surface,
  },
  badgeText: { fontSize: 10, fontWeight: "800", color: "#FFFFFF", fontVariant: ["tabular-nums"] },
});
