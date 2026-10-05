import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { Button, Caption, Pill, Segmented } from "./kit";
import { PasskeyPanel } from "./PasskeyPanel";
import { api } from "../lib/api";
import { rememberIdentity, useIdentity, type Identity } from "../lib/names";
import { usePrivyWallet } from "../lib/privy";
import { useWallet } from "../lib/wallet";
import { useWalletChoice } from "../lib/wallet-choice";
import { theme } from "../theme";

const ALL_OPTIONS = [
  { id: "local" as const, label: "Device key" },
  { id: "mera" as const, label: "Passkey" },
  { id: "privy" as const, label: "Privy" },
];

/**
 * Which wallet signs, and — with Privy — who is behind it.
 *
 * The device key needs nothing and stays on this device. A passkey (Mera) is
 * an account made from one passkey prompt and brought back by it anywhere —
 * see `PasskeyPanel`. Privy signs in with
 * email, Google or X and gives the person an embedded wallet that follows
 * their login. Choosing one does not move funds: they are two addresses, and
 * this says so.
 *
 * Signed in with Privy and an X account linked, the person can put their X
 * handle on their profile. The server checks it with Privy before it shows
 * anywhere — nobody can claim someone else's handle, or pin theirs to a
 * wallet that is not theirs.
 *
 * Renders nothing where neither Privy nor passkeys are available.
 * On a phone sign-in is email only, through Juno's own sheet.
 */
export function SignerChoice() {
  const privy = usePrivyWallet();
  const choice = useWalletChoice();
  const wallet = useWallet();
  const identity = useIdentity(wallet.address);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "pos" | "neg"; text: string } | null>(null);

  if (!choice.privyAvailable && !choice.meraAvailable) return null;
  const options = ALL_OPTIONS.filter(
    (option) => option.id === "local" || (option.id === "mera" ? choice.meraAvailable : choice.privyAvailable),
  );

  const onPrivy = choice.choice === "privy";
  const onMera = choice.choice === "mera";
  const linkedX = privy.identity?.twitter;

  const verify = async () => {
    if (!wallet.address) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await privy.getAccessToken();
      if (!token) throw new Error("Sign in with Privy first.");
      const { identity: verified } = await api.post<{ identity: Identity }>("/api/juno/profiles/privy", {
        wallet: wallet.address,
        accessToken: token,
      });
      rememberIdentity(wallet.address, verified);
      setMessage({
        tone: "pos",
        text: verified.twitter ? `@${verified.twitter} is on your profile.` : "Verified with Privy.",
      });
    } catch (error) {
      setMessage({ tone: "neg", text: error instanceof Error ? error.message : "Could not verify." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Caption>Sign with</Caption>
      <Segmented items={options} value={choice.choice} onChange={choice.choose} />
      {onMera ? (
        <PasskeyPanel />
      ) : (
        <Caption style={styles.note}>
          {onPrivy
            ? privy.authenticated
              ? `Signed in with Privy${privy.identity?.email ? ` as ${privy.identity.email}` : privy.identity?.google ? ` as ${privy.identity.google}` : linkedX ? ` as @${linkedX}` : ""}. Your embedded wallet signs every trade and launch${Platform.OS === "web" ? ", after Privy asks you to confirm" : ""}.`
              : Platform.OS === "web"
                ? "Sign in with email, Google or X. Privy gives you an embedded wallet that follows your login to any device."
                : "Sign in with your email. Privy gives you an embedded wallet that follows your login to any device — no seed phrase."
            : "A key made on this device. Nothing to sign up for, and nothing to recover it with. Switching to a passkey or Privy uses a different address."}
        </Caption>
      )}

      {onPrivy && privy.authenticated && wallet.address ? (
        identity?.twitter ? (
          <View style={styles.row}>
            <Pill label={`𝕏 @${identity.twitter}`} tone="ink" />
            <Caption>Verified with Privy</Caption>
          </View>
        ) : linkedX ? (
          <Button
            label={busy ? "Checking with Privy…" : `Show @${linkedX} on my profile`}
            variant="ink"
            loading={busy}
            onPress={() => void verify()}
          />
        ) : Platform.OS === "web" ? (
          <Caption>Link an X account in Privy to show it on your profile.</Caption>
        ) : null
      ) : null}

      {onPrivy && privy.authenticated ? (
        <Button label="Sign out of Privy" variant="quiet" onPress={() => void wallet.disconnect()} />
      ) : null}

      {message ? (
        <Text style={[styles.message, { color: message.tone === "pos" ? theme.colors.pos : theme.colors.neg }]}>
          {message.text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, alignSelf: "stretch" },
  note: { lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  message: { fontSize: theme.type.label.size, fontWeight: "600" },
});
