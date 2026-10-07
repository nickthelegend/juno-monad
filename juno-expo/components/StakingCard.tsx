import { StyleSheet, Text, View } from "react-native";

import { Button, Card } from "./kit";
import { juno } from "../lib/api";
import { money, useApi } from "../lib/useApi";
import { theme } from "../theme";

/**
 * Monad's native staking, beside the wallet.
 *
 * Read live from Monad's own network, because the staking precompile
 * (0x…1000) exists only there: the epoch, the validator proposing blocks
 * right now, the size of the consensus set, and this address's delegations.
 * Delegating is a transaction to the precompile; on a local fork it has no
 * code, so the button says where it works instead of pretending.
 */
export function StakingCard({ wallet }: { wallet: string }) {
  const staking = useApi(() => juno.staking(wallet), [wallet]);
  const fork = juno.loadedConfig()?.localFork ?? false;
  const s = staking.data;
  const where = s?.network === "monad" ? "Monad" : "Monad testnet";

  return (
    <Card testID="staking-card">
      <Text style={styles.kicker}>Stake on Monad · live from {where}</Text>
      {staking.loading ? (
        <Text style={styles.line}>Reading the staking precompile…</Text>
      ) : !s ? (
        <Text style={styles.line}>The staking precompile could not be read: {staking.error ?? "no answer"}.</Text>
      ) : (
        <View style={{ gap: 6, marginTop: 6 }}>
          <Text style={styles.big} testID="staking-epoch">
            Epoch {s.epoch.toLocaleString("en-US")}
          </Text>
          <Text style={styles.line}>
            A stake change now takes effect in epoch {s.effectiveEpoch.toLocaleString("en-US")}
            {s.inEpochDelayPeriod ? " (the epoch's delay period is on)" : ""}.
          </Text>
          <Text style={styles.line} testID="staking-proposer">
            Proposing now: validator #{s.proposer.id}, {money(s.proposer.stakeMon, "MON")} staked, {s.proposer.commissionPct}% commission
          </Text>
          {s.validators !== null ? <Text style={styles.line}>{s.validators} validators in the consensus set.</Text> : null}
          <Text style={styles.line}>
            This address on {where}:{" "}
            {s.delegations === null
              ? "delegations could not be read."
              : s.delegations.length === 0
                ? "no delegations."
                : `delegated to ${s.delegations.map((id) => `#${id}`).join(", ")}.`}
          </Text>
        </View>
      )}
      <Button
        label={fork ? "Delegate: on Monad only" : "Delegate MON"}
        variant="quiet"
        disabled
        style={{ marginTop: 12, alignSelf: "stretch" }}
      />
      <Text style={styles.caption}>
        {fork
          ? "Delegating is a transaction to Monad's staking precompile (0x…1000), which has no code on this local fork. The readings above are Monad's own."
          : "Delegating is a transaction to Monad's staking precompile (0x…1000). It opens with this deployment's testnet transactions."}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", color: theme.colors.muted },
  big: { fontSize: theme.type.title.size, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  line: { fontSize: 13, lineHeight: 19, color: theme.colors.text },
  caption: { fontSize: 11, lineHeight: 15, color: theme.colors.muted, marginTop: 6 },
});
