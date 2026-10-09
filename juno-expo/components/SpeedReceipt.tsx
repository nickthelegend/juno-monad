import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Image, Platform, Share, StyleSheet, Text, View } from "react-native";

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
            <Text style={styles.heroCaption}>
              broadcast to receipt{fork ? " on a local fork" : ""}, measured by Juno&rsquo;s server
            </Text>
          </View>
          <View style={styles.hero} accessibilityLabel="Final">
            <Text style={styles.timerLabel}>Final</Text>
            <View style={styles.heroRow}>
              <Text testID="speed-final" style={[styles.ms, styles.msSecond]}>
                {fork ? (networkFinal ?? "—") : (ownFinal ?? "…")}
              </Text>
              <Text style={styles.unit}>ms</Text>
            </View>
            <Text style={styles.heroCaption}>
              {fork
                ? "Monad testnet's finality right now (live median); a fork has no consensus to time"
                : "this trade, proposed to finalized, from Monad's commit stream"}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.steps}>
        <Step label="Signed here" value={signedInMs === null ? null : `${signedInMs} ms`} />
        <View style={styles.link} />
        <Step label="Confirmed" value={confirmedInMs === null ? null : `${confirmedInMs} ms`} />
        <View style={styles.link} />
        <Step label="Block" value={c ? `#${c.blockNumber.toLocaleString("en-US")}` : null} />
      </View>

      {fork ? null : <FinalityTimeline txHash={txHash} />}

      {c ? (
        <View style={styles.cost}>
          <View style={styles.costRow}>
            <Text style={styles.costLabel}>Paid</Text>
            <Text testID="speed-fee" style={styles.costValue}>
              {feeMon(c.monad.feeMon)} MON{c.monad.feeUsd === null ? "" : ` · ${usd(c.monad.feeUsd)}`}
            </Text>
          </View>
          <Text style={styles.costCaption}>
            {c.monad.billed === "limit"
              ? `${c.monad.gasCharged.toLocaleString("en-US")} gas at ${gwei(c.monad.gasPriceGwei)} gwei. Monad bills the gas limit; this trade used ${c.monad.gasUsed.toLocaleString("en-US")}.`
              : `${c.monad.gasUsed.toLocaleString("en-US")} gas at ${gwei(c.monad.gasPriceGwei)} gwei, billed as used on this fork.`}
          </Text>
          {c.ethereum ? (
            <>
              <View style={[styles.costRow, { marginTop: 10 }]}>
                <Text style={styles.costLabel}>Same gas on Ethereum now</Text>
                <Text testID="speed-ethereum" style={styles.costValue}>
                  {c.ethereum.feeUsd === null ? `${tokens(c.ethereum.feeEth)} ETH` : usd(c.ethereum.feeUsd)} ·{" "}
                  {c.ethereum.blockSeconds} s blocks
                </Text>
              </View>
              <Text style={styles.costCaption}>
                {`${c.monad.gasUsed.toLocaleString("en-US")} gas at Ethereum mainnet's ${gwei(c.ethereum.gasPriceGwei)} gwei, read from ${c.ethereum.gasPriceSource} just now`}
                {c.ethereum.ethUsd === null ? "." : `, ETH ${usd(c.ethereum.ethUsd)} from Pyth.`}
              </Text>
            </>
          ) : null}
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

function Step({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.step}>
      <View style={[styles.dot, value !== null ? styles.dotOn : null]} />
      <Text style={styles.stepLabel}>{label}</Text>
      <Text style={styles.stepValue}>{value ?? "—"}</Text>
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
  heroCaption: { fontSize: 12, lineHeight: 16, color: theme.colors.muted, textAlign: "center", maxWidth: 300 },
  steps: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center" },
  step: { alignItems: "center", gap: 4, minWidth: 84 },
  link: { height: 2, width: 22, backgroundColor: theme.colors.lime, marginTop: 5 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.line },
  dotOn: { backgroundColor: theme.colors.pos },
  stepLabel: { fontSize: 11, fontWeight: "700", color: theme.colors.muted },
  stepValue: { fontSize: 13, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  cost: { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.md, padding: 14 },
  costRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  costLabel: { fontSize: 13, fontWeight: "700", color: theme.colors.text, flexShrink: 1 },
  costValue: { fontSize: 13, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  costCaption: { fontSize: 11, lineHeight: 15, color: theme.colors.muted, marginTop: 4 },
  share: { gap: 8 },
  card: { width: "100%", aspectRatio: 1200 / 630, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  shareRow: { flexDirection: "row", gap: 8 },
  shareNote: { fontSize: 12, color: theme.colors.muted, textAlign: "center" },
});
