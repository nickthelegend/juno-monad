import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, Card } from "./kit";
import { juno, type Coin } from "../lib/api";
import { earningsOf } from "../lib/earnings";
import { money } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * What a creator's posts have earned them.
 *
 * "Creators earn the trading fees" is Juno's promise; this is where it is
 * kept. Every figure is read from the chain, coin by coin: the fees each
 * pool holds for its creator now (claimable), what has already been paid out
 * (claimed), lifetime volume, holders and fills. A per-post bar chart ranks
 * the coins by what they earned. Claim all signs one claim per coin that has
 * something to claim; nothing is claimed that is not there.
 */
export function Earnings({ wallet, coins, onClaimed }: { wallet: string; coins: Coin[]; onClaimed: () => void }) {
  const signer = useWallet();
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<{ tone: "pos" | "neg"; text: string } | null>(null);

  const { rows, currency, earned, claimable, claimed, volume, holders, fills, owed } = earningsOf(coins);
  const top = rows[0]?.earned ?? 0;

  const claimAll = async () => {
    if (claiming || owed.length === 0) return;
    setClaiming(true);
    setMessage(null);
    let done = 0;
    try {
      for (const row of owed) {
        const { steps } = await juno.claim({ creator: wallet, token: row.coin.address });
        await signer.signAndSubmit(steps);
        done++;
      }
      setMessage({ tone: "pos", text: `Claimed from ${done} ${done === 1 ? "coin" : "coins"}.` });
      onClaimed();
    } catch (caught) {
      const why = caught instanceof Error ? caught.message : "The claim failed.";
      setMessage({ tone: "neg", text: done > 0 ? `Claimed from ${done}, then: ${why}` : why });
      if (done > 0) onClaimed();
    } finally {
      setClaiming(false);
    }
  };

  if (!currency) {
    return (
      <Card>
        <Text style={styles.kicker}>Earnings</Text>
        <Text style={styles.caption}>Your coins are priced in different currencies, so their fees are not summed.</Text>
      </Card>
    );
  }

  return (
    <Card testID="earnings">
      <Text style={styles.kicker}>Earnings · read from the chain</Text>
      <View style={styles.headline}>
        <Text style={styles.big} testID="earnings-total">
          {money(earned, currency, { compact: false })}
        </Text>
        <Text style={styles.caption}>earned in trading fees</Text>
      </View>
      <View style={styles.split}>
        <Figure label="claimable now" value={money(claimable, currency, { compact: false })} testID="earnings-claimable" />
        <Figure label="claimed" value={money(claimed, currency, { compact: false })} />
        <Figure label="volume" value={volume === null ? "—" : money(volume, currency)} />
      </View>
      <View style={styles.split}>
        <Figure label="holders" value={holders === null ? "—" : holders.toLocaleString("en-US")} />
        <Figure label="fills" value={fills === null ? "—" : String(fills)} />
        <Figure label="coins" value={String(coins.length)} />
      </View>

      <Text style={[styles.kicker, { marginTop: 14 }]}>By post</Text>
      <View style={{ gap: 8, marginTop: 6 }}>
        {rows.map((row) => (
          <View key={row.coin.address} style={styles.barRow} testID="earnings-row">
            <Text style={styles.barLabel} numberOfLines={1}>
              ${row.coin.symbol}
            </Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${top > 0 ? Math.max(2, (row.earned / top) * 100) : 0}%` }]} />
            </View>
            <Text style={styles.barValue}>{money(row.earned, currency)}</Text>
          </View>
        ))}
      </View>

      <Button
        label={owed.length === 0 ? "Nothing to claim" : `Claim ${money(claimable, currency, { compact: false })}`}
        onPress={() => void claimAll()}
        loading={claiming}
        disabled={owed.length === 0}
        style={{ marginTop: 14, alignSelf: "stretch" }}
      />
      {message ? <Text style={[styles.caption, { color: message.tone === "pos" ? theme.colors.pos : theme.colors.neg, marginTop: 6 }]}>{message.text}</Text> : null}
    </Card>
  );
}

function Figure({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue} testID={testID}>
        {value}
      </Text>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", color: theme.colors.muted },
  headline: { marginTop: 6 },
  big: { fontSize: theme.type.heading.size, fontWeight: "800", letterSpacing: -0.5, color: theme.colors.text, fontVariant: ["tabular-nums"] },
  split: { flexDirection: "row", marginTop: 12 },
  figure: { flex: 1, gap: 2 },
  figureValue: { fontSize: 15, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  caption: { fontSize: 12, color: theme.colors.muted },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { width: 82, fontSize: 12, fontWeight: "800", color: theme.colors.text },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: theme.colors.surfaceAlt, overflow: "hidden" },
  barFill: { height: 10, borderRadius: 5, backgroundColor: theme.colors.lime },
  barValue: { width: 72, textAlign: "right", fontSize: 12, fontWeight: "700", color: theme.colors.text, fontVariant: ["tabular-nums"] },
});
