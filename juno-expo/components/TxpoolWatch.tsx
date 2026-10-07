import { useEffect } from "react";
import { StyleSheet, Text } from "react-native";

import { juno } from "../lib/api";
import { useApi } from "../lib/useApi";
import { theme } from "../theme";

/**
 * A transaction the network accepted but has not confirmed: what Monad's
 * transaction pool says about it, asked every second.
 *
 * `eth_getTransactionByHash` on Monad does not show a transaction until it is
 * in a block, so this asks `txpool_statusByHash` instead: pending, dropped
 * (with the node's reason), or included. A local fork has no txpool to ask,
 * and this says nothing rather than inventing a state.
 */
export function TxpoolWatch({ hash }: { hash: string }) {
  const status = useApi(() => juno.txStatus(hash), [hash]);
  const { refresh } = status;
  const settled = status.data?.supported === false || ["included", "dropped", "error"].includes(status.data?.status ?? "");
  useEffect(() => {
    if (settled) return;
    const timer = setInterval(refresh, 1_000);
    const stop = setTimeout(() => clearInterval(timer), 30_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [refresh, settled]);
  const data = status.data;
  if (!data || !data.supported) return null;
  return (
    <Text style={styles.line} testID="txpool-status">
      Monad&rsquo;s transaction pool says: {data.status}
      {data.reason ? ` (${data.reason})` : ""}.
    </Text>
  );
}

const styles = StyleSheet.create({
  line: { fontSize: 12, lineHeight: 17, color: theme.colors.muted, textAlign: "center" },
});
