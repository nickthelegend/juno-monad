import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Image, Platform, Pressable, Share, StyleSheet, Text, View } from "react-native";

import { FinalityTimeline } from "./Finality";
import { Button } from "./kit";
import { API_URL, juno } from "../lib/api";
import { useLive } from "../lib/live";
import { tokens, useApi } from "../lib/useApi";
import { theme } from "../theme";

/**
 * The receipt that shows why this runs on Monad.
 *
 * One measured figure leads: the milliseconds from broadcast to a receipt in
 * hand, timed by Juno's server around `eth_sendRawTransactionSync`. Under it,
 * the trade's own timeline (signed on this device, confirmed, final), what
 * the transaction cost from its receipt, and what the same gas would cost on
 * Ethereum mainnet at this moment's gas price. Every figure is measured or
 * read; one that could not be read is left out rather than estimated.
 */
export function SpeedReceipt({
  txHash,
  confirmedInMs,
  signedInMs,
}: {
  txHash: string;
  /** Broadcast to receipt, as the server measured it. */
  confirmedInMs: number | null;
  /** Signing on this device, as the sheet measured it. Null when not measured. */
  signedInMs: number | null;
}) {
  const cost = useApi(() => juno.txCost(txHash), [txHash]);
  const fork = juno.loadedConfig()?.localFork ?? false;
  const [details, setDetails] = useState(false);
  const c = cost.data;
  // The second timer. On Monad it is this trade's own: Proposed to Finalized,
  // from the commit stream. A local fork has no consensus to time, so it is
  // Monad testnet's live finality instead, and says it is the network's.
  const live = useLive({ tx: txHash }, { intervalMs: 350, forMs: 15_000, enabled: !fork });
  const event = live?.events[0];
  const ownFinal =
    event?.stages.Finalized !== undefined && event.stages.Proposed !== undefined ? event.stages.Finalized - event.stages.Proposed : null;
  const network = useApi(() => (fork ? juno.heartbeat() : Promise.resolve(null)), [fork]);
  const { refresh: refreshNetwork } = network;
  const networkFinal = network.data?.finalizedMs ?? null;
  useEffect(() => {
    if (!fork || networkFinal !== null) return;
    const timer = setInterval(refreshNetwork, 1_000);
    return () => clearInterval(timer);
  }, [fork, networkFinal, refreshNetwork]);

  return (
    <View style={styles.wrap}>
      {confirmedInMs !== null ? (
        <View style={styles.timers}>
          <View style={styles.hero} accessibilityLabel={`Executed in ${confirmedInMs} milliseconds`}>
            <Text style={styles.timerLabel}>Executed</Text>
            <View style={styles.heroRow}>
              <Text testID="speed-ms" style={styles.ms}>
                {confirmedInMs.toLocaleString("en-US")}
              </Text>
              <Text style={styles.unit}>ms</Text>
            </View>
            {fork ? <Tag label="local fork" /> : null}
          </View>
          <View style={styles.hero} accessibilityLabel="Final">
            <Text style={styles.timerLabel}>Final</Text>
            <View style={styles.heroRow}>
              <Text testID="speed-final" style={[styles.ms, styles.msSecond]}>
                {fork ? (networkFinal ?? "—") : (ownFinal ?? "…")}
              </Text>
              <Text style={styles.unit}>ms</Text>
            </View>
            {/* A fork has no consensus to time: this is Monad testnet's, now. */}
            {fork ? <Tag label="Monad testnet, live" /> : null}
          </View>
        </View>
      ) : null}

      {c ? (
        <View style={styles.compare}>
          <View style={styles.compareCell}>
            <Text style={styles.compareLabel}>Paid here</Text>
            <Text style={styles.compareValue}>{c.monad.feeUsd === null ? `${feeMon(c.monad.feeMon)} MON` : usd(c.monad.feeUsd)}</Text>
          </View>
          {c.ethereum ? (
            <View style={styles.compareCell}>
              <Text style={styles.compareLabel}>Same gas on Ethereum</Text>
              <Text testID="speed-ethereum" style={[styles.compareValue, { color: theme.colors.neg }]}>
                {c.ethereum.feeUsd === null ? `${tokens(c.ethereum.feeEth)} ETH` : usd(c.ethereum.feeUsd)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Pressable onPress={() => setDetails((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: details }} style={styles.detailsToggle} testID="speed-details-toggle">
        <Text style={styles.detailsToggleText}>{details ? "Hide details" : "Details"}</Text>
      </Pressable>
      {details ? (
        <View style={styles.cost} testID="speed-details">
          <Detail label="Signed here" value={signedInMs === null ? "—" : `${signedInMs} ms`} />
          <Detail label="Block" value={c ? `#${c.blockNumber.toLocaleString("en-US")}` : "—"} />
          {c ? <Detail label="Fee" value={`${feeMon(c.monad.feeMon)} MON`} testID="speed-fee" /> : null}
          {c ? (
            <Detail
              label="Gas"
              value={
                c.monad.billed === "limit"
                  ? `${c.monad.gasCharged.toLocaleString("en-US")} billed (limit) · ${c.monad.gasUsed.toLocaleString("en-US")} used`
                  : `${c.monad.gasUsed.toLocaleString("en-US")} used, billed as used (fork)`
              }
            />
          ) : null}
          {c ? <Detail label="Gas price" value={`${gwei(c.monad.gasPriceGwei)} gwei`} /> : null}
          {c?.ethereum ? (
            <Detail
              label="Ethereum"
              value={`${gwei(c.ethereum.gasPriceGwei)} gwei from ${c.ethereum.gasPriceSource}${c.ethereum.ethUsd === null ? "" : ` · ETH ${usd(c.ethereum.ethUsd)} (Pyth)`}`}
            />
          ) : null}
          <Detail label="Executed" value="broadcast to receipt, timed by Juno's server" />
          {fork ? null : <FinalityTimeline txHash={txHash} />}
        </View>
      ) : null}

      <ShareCard txHash={txHash} />
    </View>
  );
}

/**
 * The receipt as an image, for posting: `GET /tx/card` draws it on the
 * server from the server's own figures, so what is shared is what was
 * measured. Shown on request, then shared as a file where the browser can
 * (a phone's share sheet), downloaded where it cannot, or copied as a link.
 */
function ShareCard({ txHash }: { txHash: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const url = `${API_URL}/api/juno/tx/card?hash=${txHash}`;

  const share = async () => {
    setNote(null);
    try {
      if (Platform.OS !== "web") {
        await Share.share({ url, message: "My trade on Juno, on Monad" });
        return;
      }
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], `juno-receipt-${txHash.slice(2, 10)}.png`, { type: "image/png" });
      const nav = globalThis.navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: "My Juno receipt" });
        return;
      }
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(link.href);
      setNote("Saved the image.");
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      setNote("Could not share the image. Copy the link instead.");
    }
  };

  const copy = async () => {
    await Clipboard.setStringAsync(url);
    setNote("Link copied.");
  };

  if (!open) {
    return <Button label="Share this receipt" variant="quiet" onPress={() => setOpen(true)} />;
  }
  return (
    <View style={styles.share} testID="receipt-card">
      <Image source={{ uri: url }} style={styles.card} accessibilityLabel="Your receipt, as an image" resizeMode="contain" />
      <View style={styles.shareRow}>
        <Button label={Platform.OS === "web" ? "Share image" : "Share"} onPress={() => void share()} style={{ flex: 1 }} />
        <Button label="Copy link" variant="quiet" onPress={() => void copy()} style={{ flex: 1 }} />
      </View>
      {note ? <Text style={styles.shareNote}>{note}</Text> : null}
    </View>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <View style={styles.tag}>
      <Text style={styles.tagText}>{label}</Text>
    </View>
  );
}

function Detail({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} testID={testID}>
        {value}
      </Text>
    </View>
  );
}

/** A fee in MON with two significant figures past the zeros: 0.0063, 0.000052. */
function feeMon(value: number): string {
  if (value === 0) return "0";
  if (value >= 1) return value.toFixed(3);
  const decimals = Math.min(12, Math.max(2, 1 - Math.floor(Math.log10(value))));
  return value.toFixed(decimals);
}

function usd(value: number): string {
  if (value >= 100) return `$${Math.round(value).toLocaleString("en-US")}`;
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  if (value === 0) return "$0";
  const decimals = Math.min(12, 1 - Math.floor(Math.log10(value)));
  return `$${value.toFixed(decimals)}`;
}

function gwei(value: number): string {
  return value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toPrecision(2);
}

const styles = StyleSheet.create({
  wrap: { alignSelf: "stretch", gap: 14, marginTop: 6 },
  timers: { flexDirection: "row", justifyContent: "center", gap: 18 },
  hero: { alignItems: "center", gap: 2, flex: 1 },
  timerLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", color: theme.colors.muted },
  msSecond: { color: theme.colors.pos },
  heroRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  ms: {
    fontSize: 44,
    lineHeight: 50,
    fontWeight: "800",
    letterSpacing: -2,
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
  },
  unit: { fontSize: 22, fontWeight: "800", color: theme.colors.pos },
  cost: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: 14 },
  tag: { marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.colors.surfaceAlt },
  tagText: { fontSize: 11, fontWeight: "700", color: theme.colors.muted },
  compare: { flexDirection: "row", gap: 8 },
  compareCell: { flex: 1, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: 12, alignItems: "center", gap: 2 },
  compareLabel: { fontSize: 12, fontWeight: "700", color: theme.colors.muted },
  compareValue: { fontSize: 20, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  detailsToggle: { alignSelf: "center", paddingVertical: 4, paddingHorizontal: 10 },
  detailsToggleText: { fontSize: 13, fontWeight: "700", color: theme.colors.muted, textDecorationLine: "underline" },
  detail: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 3 },
  detailLabel: { fontSize: 12, color: theme.colors.muted },
  detailValue: { fontSize: 12, fontWeight: "700", color: theme.colors.text, flexShrink: 1, textAlign: "right" },
  share: { gap: 8 },
  card: { width: "100%", aspectRatio: 1200 / 630, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  shareRow: { flexDirection: "row", gap: 8 },
  shareNote: { fontSize: 12, color: theme.colors.muted, textAlign: "center" },
});
