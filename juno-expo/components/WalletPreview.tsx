import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { CoinArt, Identicon } from "./art";
import { Button, Caption } from "./kit";
import { SponsorBadge } from "./Sponsor";
import { api, juno } from "../lib/api";
import { topCreatorOf } from "../lib/discover";
import { loadMarkets } from "../lib/markets";
import { createMeraAccount, unlockMeraAccount } from "../lib/mera";
import { useApi } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { useWalletChoice } from "../lib/wallet-choice";
import { theme } from "../theme";

/**
 * Profile, before there is a wallet: what you get, and one tap to get it.
 *
 * The empty profile used to be a "Sign with" switch and a blank page, a weak
 * second screen for anyone who opened it first. It now shows:
 * - what a profile is, with a real one from the feed to open as the example
 *   (the creator with the most posts, and their own figures);
 * - what starting costs, read from the server: the faucet's MON;
 * - one button that makes the account. With passkeys available that is a
 *   Mera passkey account: one prompt makes it, nothing secret is stored, and
 *   the same passkey brings it back anywhere. The device key and Privy stay
 *   one tap away.
 */
export function WalletPreview() {
  const router = useRouter();
  const wallet = useWallet();
  const choice = useWalletChoice();
  const [busy, setBusy] = useState<"passkey" | "unlock" | "local" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const faucet = useApi(() => api.get<{ amount: number }>("/api/juno/faucet").catch(() => null), []);
  const markets = useApi(() => loadMarkets(), []);
  const example = useMemo(() => topCreatorOf(markets.data?.posts ?? []), [markets.data?.posts]);

  const run = async (kind: "passkey" | "unlock" | "local", action: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  // The passkey makes the account itself; switching the signer to it then
  // restores that account, so it is one prompt, not a switch and a second tap.
  const passkey = () =>
    run("passkey", async () => {
      await createMeraAccount();
      choice.choose("mera");
    });
  const unlock = () =>
    run("unlock", async () => {
      await unlockMeraAccount();
      choice.choose("mera");
    });
  const local = () =>
    run("local", async () => {
      if (choice.choice !== "local") choice.choose("local");
      await wallet.connect();
    });

  return (
    <View style={styles.wrap} testID="wallet-preview">
      <Text style={styles.kicker}>Your profile</Text>
      <Text style={styles.title}>Post a photo. It becomes a coin. You earn its trading fees.</Text>

      <View style={styles.card}>
        <Point n="1" title="Every post is a market" detail="A photo or a reel launches its own bonding curve on Monad, in one transaction." />
        <Point
          n="2"
          title="Creators earn the fees"
          detail="Your coins' trading fees are yours to claim. Your profile adds them up, from the chain."
        />
        <Point
          n="3"
          title={faucet.data ? `${faucet.data.amount} MON to start` : "Testnet MON to start"}
          detail="Juno's faucet pays a new wallet testnet MON, enough for a launch and a few buys."
        />
      </View>

      {example ? (
        <Pressable
          style={styles.example}
          onPress={() => router.push(`/trader/${example.wallet}` as never)}
          accessibilityRole="link"
          accessibilityLabel={`Open ${example.name}'s profile`}
          testID="preview-example"
        >
          <Identicon seed={example.wallet} size={40} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.exampleName} numberOfLines={1}>
              {example.name}
            </Text>
            <Caption numberOfLines={1}>
              {example.posts} {example.posts === 1 ? "post" : "posts"}
              {example.holders > 0 ? ` · ${example.holders.toLocaleString("en-US")} holders` : ""} · a real profile
            </Caption>
          </View>
          <View style={styles.thumbs}>
            {example.coins.slice(0, 3).map((coin) => (
              <CoinArt key={coin.address} uri={juno.still(coin.media)} seed={coin.address} size={34} radius={8} />
            ))}
          </View>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        {choice.meraAvailable ? (
          <>
            <Button
              label={busy === "passkey" ? "Waiting for your passkey…" : "Create a passkey account"}
              variant="lime"
              tall
              loading={busy === "passkey"}
              onPress={() => void passkey()}
              style={{ alignSelf: "stretch" }}
            />
            <View style={{ alignItems: "center" }}>
              <SponsorBadge sponsor="mera" claim="One prompt, no seed phrase" detail="Mera passkey" />
            </View>
            <Button
              label={busy === "unlock" ? "Waiting for your passkey…" : "I have a passkey account"}
              variant="quiet"
              loading={busy === "unlock"}
              onPress={() => void unlock()}
            />
          </>
        ) : null}
        <Button
          label={busy === "local" ? "Making a key…" : choice.meraAvailable ? "Create wallet with a device key instead" : "Create wallet"}
          variant={choice.meraAvailable ? "quiet" : "lime"}
          tall={!choice.meraAvailable}
          loading={busy === "local"}
          onPress={() => void local()}
          style={choice.meraAvailable ? undefined : { alignSelf: "stretch" }}
        />
        {choice.privyAvailable ? (
          <Button
            label="Sign in with Privy"
            variant="quiet"
            onPress={() => {
              choice.choose("privy");
              void wallet.connect().catch(() => undefined);
            }}
          />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

function Point({ n, title, detail }: { n: string; title: string; detail: string }) {
  return (
    <View style={styles.point}>
      <View style={styles.pointMark}>
        <Text style={styles.pointN}>{n}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.pointTitle}>{title}</Text>
        <Caption>{detail}</Caption>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 140 },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", color: theme.colors.muted },
  title: { fontSize: 24, lineHeight: 29, fontWeight: "800", letterSpacing: -0.6, color: theme.colors.text },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 16, gap: 14, ...theme.shadow.card },
  point: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  pointMark: { width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.lime, alignItems: "center", justifyContent: "center" },
  pointN: { fontSize: 13, fontWeight: "900", color: theme.colors.onLime },
  pointTitle: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  example: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surfaceAlt },
  exampleName: { fontSize: 15, fontWeight: "800", color: theme.colors.text },
  thumbs: { flexDirection: "row", gap: 4 },
  actions: { gap: 8, marginTop: 4 },
  error: { color: theme.colors.neg, fontSize: 13, fontWeight: "600", textAlign: "center" },
});
