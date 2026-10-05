import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, Caption } from "./kit";
import { endMeraSession, meraState, onMeraState, SESSION_MS, unlockMeraAccount, type MeraSessionState } from "../lib/mera";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/** The passkey session as it stands, ticking once a second while one is open. */
function useMeraSession(): MeraSessionState & { left: number | null } {
  const [state, setState] = useState(meraState);
  const [now, setNow] = useState(Date.now());
  useEffect(() => onMeraState(setState), []);
  useEffect(() => {
    if (!state.expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [state.expiresAt]);
  const left = state.expiresAt ? Math.max(0, state.expiresAt - now) : null;
  return { ...state, left: left && left > 0 ? left : null };
}

function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The passkey account on the profile: make one, bring one back, and see the
 * signing session.
 *
 * One prompt makes the account. While a session is open, trades sign without
 * asking — the countdown says for how long — and ending it zeroes the key;
 * the next trade asks for the passkey once. Nothing secret is stored, so a
 * cleared browser or a new device gets the same account back from the
 * passkey alone.
 */
export function PasskeyPanel() {
  const wallet = useWallet();
  const session = useMeraSession();
  const [busy, setBusy] = useState<"create" | "unlock" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (kind: "create" | "unlock", run: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The passkey did not answer.");
    } finally {
      setBusy(null);
    }
  };

  if (!wallet.address) {
    return (
      <View style={styles.box}>
        <Caption style={styles.note}>
          A passkey is the whole account: no seed phrase, no extension, nothing kept on a server. One prompt makes
          it, and the same passkey brings it back on any device.
        </Caption>
        <Button
          label={busy === "create" ? "Waiting for your passkey…" : "Create a passkey account"}
          variant="ink"
          loading={busy === "create"}
          onPress={() => void act("create", () => wallet.connect())}
        />
        <Button
          label={busy === "unlock" ? "Waiting for your passkey…" : "Sign in with my passkey"}
          variant="quiet"
          loading={busy === "unlock"}
          onPress={() =>
            void act("unlock", async () => {
              await unlockMeraAccount();
              await wallet.connect();
            })
          }
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.box}>
      {session.left !== null ? (
        <>
          <Caption style={styles.note}>
            Signing session open · <Text style={styles.clock}>{clock(session.left)}</Text> left. Trades sign without
            asking until then; ending it wipes the key.
          </Caption>
          <Button label="End session" variant="quiet" onPress={endMeraSession} />
        </>
      ) : (
        <>
          <Caption style={styles.note}>
            Locked. Your next trade asks for your passkey once, then signs without asking for{" "}
            {Math.round(SESSION_MS / 60_000)} minutes.
          </Caption>
          <Button
            label={busy === "unlock" ? "Waiting for your passkey…" : "Unlock now"}
            variant="quiet"
            loading={busy === "unlock"}
            onPress={() => void act("unlock", () => unlockMeraAccount(wallet.address))}
          />
        </>
      )}
      <Button label="Sign out of this passkey" variant="quiet" onPress={() => void wallet.disconnect()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8, alignSelf: "stretch" },
  note: { lineHeight: 18 },
  clock: { fontWeight: "800", color: theme.colors.ink, fontVariant: ["tabular-nums"] },
  error: { fontSize: theme.type.label.size, fontWeight: "600", color: theme.colors.neg },
});
