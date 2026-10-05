import { useCallback, useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { Button, Caption, Card, Label, Pill, Row } from "./kit";
import { juno, type AutopilotStatus } from "../lib/api";
import { autopilotConfig, cachedAutopilot, onAutopilot, rememberAutopilot } from "../lib/autopilot-relay";
import { usePrivyWallet } from "../lib/privy";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * Autopilot on the profile, above the plans it runs.
 *
 * On: Juno's server key is a session signer on the person's Privy wallet,
 * under a policy written for that wallet (Juno trades paid out to it, a MON
 * cap per trade, 30 days). Due plans buy themselves, and with Privy's gas
 * sponsorship every autopilot transaction is free to the person. Off: the key
 * comes off the wallet and Juno stops acting.
 *
 * On a server without a Privy signer, the card says autopilot is not set up
 * there, and offers nothing it cannot do.
 */
export function AutopilotCard() {
  const wallet = useWallet();
  const privy = usePrivyWallet();
  const config = autopilotConfig();
  const [status, setStatus] = useState<AutopilotStatus | null>(() => cachedAutopilot(wallet.address));
  const [busy, setBusy] = useState<"on" | "off" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onAutopilot(() => setStatus(cachedAutopilot(wallet.address))), [wallet.address]);

  const refresh = useCallback(async () => {
    if (!wallet.address || config?.mode !== "privy") return;
    try {
      rememberAutopilot(wallet.address, await juno.autopilot(wallet.address));
    } catch {
      // The card keeps what it last knew; the next visit reads again.
    }
  }, [wallet.address, config?.mode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!config || !wallet.address) return null;

  if (config.mode === "off") {
    return (
      <Card style={styles.card}>
        <Row gap={8} style={styles.head}>
          <Label style={styles.title}>Autopilot</Label>
          <Pill label="Not set up" tone="neutral" />
        </Row>
        <Caption style={styles.note}>
          Autopilot buys your plans for you through a Privy session signer, with gas paid by Privy. This server has
          no Privy signer set up yet, so your plans tell you when a buy is due and you sign it.
        </Caption>
      </Card>
    );
  }

  const address = wallet.address;
  const needsPrivy = wallet.mode !== "privy";

  const session = async () => {
    const accessToken = await privy.getAccessToken();
    if (!accessToken) throw new Error("Sign in with Privy first.");
    return { accessToken };
  };

  const run = async (kind: "on" | "off", work: () => Promise<AutopilotStatus>) => {
    setBusy(kind);
    setError(null);
    try {
      rememberAutopilot(address, await work());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Autopilot did not answer.");
    } finally {
      setBusy(null);
    }
  };

  const turnOn = () =>
    run("on", async () => {
      const auth = await session();
      const started = await juno.autopilotAction({ action: "start", wallet: address, ...auth });
      if (started.status !== "pending") return started;
      // Put Juno's key on the wallet under this wallet's policy, then have the server check it is there.
      await privy.addSigner(started.signerId!, started.policyId!);
      return juno.autopilotAction({ action: "confirm", wallet: address, ...auth });
    });

  const turnOff = () =>
    run("off", async () => {
      const stopped = await juno.autopilotAction({ action: "stop", wallet: address, ...(await session()) });
      await privy.removeSigners();
      return stopped;
    });

  const on = status?.status === "active";
  const until = status?.expiresAt ? new Date(status.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const runs = (status?.runs ?? []).slice(0, 3);

  return (
    <Card style={styles.card}>
      <Row gap={8} style={styles.head}>
        <Label style={styles.title}>Autopilot</Label>
        <Pill label={on ? "On" : status?.status === "expired" ? "Expired" : "Off"} tone={on ? "lime" : "neutral"} />
      </Row>
      <Caption style={styles.note}>
        {on
          ? `Juno buys your due plans for you${config.sponsor ? ", and Privy pays the gas, for those and for your trades" : ""}. Until ${until}.`
          : `Let Juno buy your plans when they come due${config.sponsor ? ", with gas paid by Privy" : ""}. Juno can only trade Juno coins for this wallet, paid out to it, up to ${config.maxPerTradeMon} MON a trade, for ${config.days} days. Turn it off any time.`}
      </Caption>
      {needsPrivy ? (
        <Caption style={styles.note}>Autopilot runs on a Privy wallet. Switch to Privy above to use it.</Caption>
      ) : on ? (
        <Button label={busy === "off" ? "Turning off…" : "Turn off"} variant="quiet" loading={busy === "off"} onPress={() => void turnOff()} />
      ) : (
        <Button
          label={busy === "on" ? "Turning on…" : "Turn on autopilot"}
          variant="ink"
          loading={busy === "on"}
          onPress={() => void turnOn()}
        />
      )}
      {runs.length > 0 ? (
        <View style={styles.runs}>
          {runs.map((item) => (
            <Text
              key={`${item.at}-${item.label}`}
              style={[styles.run, item.error ? styles.failed : null]}
              onPress={item.hash && !juno.loadedConfig()?.localFork ? () => void Linking.openURL(juno.explorer("tx", item.hash!)) : undefined}
              numberOfLines={2}
            >
              {item.label}
              {item.error ? `: ${item.error}` : item.sponsored ? " · gas paid by Privy" : ""}
              {" · "}
              {new Date(item.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </Text>
          ))}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8, marginBottom: 12 },
  head: { alignItems: "center", justifyContent: "space-between" },
  title: { fontWeight: "700" },
  note: { lineHeight: 18 },
  runs: { gap: 4, marginTop: 4 },
  run: { fontSize: theme.type.label.size, color: theme.colors.muted },
  failed: { color: theme.colors.neg },
  error: { fontSize: theme.type.label.size, fontWeight: "600", color: theme.colors.neg },
});
