import { StyleSheet, Text, View } from "react-native";

import { FinalityTimeline } from "./Finality";
import { juno } from "../lib/api";
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

  return (
    <View style={styles.wrap}>
      {confirmedInMs !== null ? (
        <View style={styles.hero} accessibilityLabel={`Confirmed in ${confirmedInMs} milliseconds`}>
          <View style={styles.heroRow}>
            <Text testID="speed-ms" style={styles.ms}>
              {confirmedInMs.toLocaleString("en-US")}
            </Text>
            <Text style={styles.unit}>ms</Text>
          </View>
          <Text style={styles.heroCaption}>
            from broadcast to receipt on {fork ? "a local fork of Monad testnet" : "Monad"}, measured by Juno&rsquo;s server
          </Text>
        </View>
      ) : null}

      <View style={styles.steps}>
        <Step label="Signed here" value={signedInMs === null ? null : `${signedInMs} ms`} />
        <View style={styles.link} />
        <Step label="Confirmed" value={confirmedInMs === null ? null : `${confirmedInMs} ms`} />
        <View style={styles.link} />
        <Step label="Block" value={c ? `#${c.blockNumber.toLocaleString("en-US")}` : null} />
      </View>

      <FinalityTimeline txHash={txHash} />

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
  hero: { alignItems: "center", gap: 4 },
  heroRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  ms: {
    fontSize: 56,
    lineHeight: 60,
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
});
