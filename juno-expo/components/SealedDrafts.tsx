import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { Button, Caption, Card } from "./kit";
import { deleteDraft, listDrafts, openDraft, sealDraft, type DraftContent, type SealedDraft } from "../lib/drafts";
import { useApi } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * Drafts sealed to the creator's passkey, in the composer.
 *
 * "Seal this draft" encrypts the name, ticker and caption with a key from the
 * passkey (Mera secret vault — its own PRF salt, not the wallet's key) and
 * keeps only the ciphertext on Juno's server. "Open" asks for the passkey and
 * fills the form back in, on this device or any other with the same passkey.
 * Media is not sealed — pick it again.
 */
export function SealedDrafts({ current, onOpen }: { current: DraftContent; onOpen: (draft: DraftContent) => void }) {
  const wallet = useWallet();
  const drafts = useApi(() => (wallet.address ? listDrafts(wallet.address) : Promise.resolve(null)), [wallet.address]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "pos" | "neg"; text: string } | null>(null);

  const act = async (key: string, run: () => Promise<string>) => {
    setBusy(key);
    setMessage(null);
    try {
      setMessage({ tone: "pos", text: await run() });
    } catch (caught) {
      setMessage({ tone: "neg", text: caught instanceof Error ? caught.message : "That did not work." });
    } finally {
      setBusy(null);
    }
  };

  const empty = !current.name.trim() && !current.caption.trim() && !current.symbol.trim();
  const list = drafts.data?.drafts ?? [];

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Sealed drafts</Text>
      <Caption>
        Encrypted to your passkey and kept as ciphertext — only your passkey opens them, on any device. Words only;
        pick the photo again.
      </Caption>
      <Button
        label={busy === "seal" ? "Sealing…" : "Seal this draft"}
        variant="ink"
        loading={busy === "seal"}
        disabled={empty || busy !== null}
        onPress={() =>
          void act("seal", async () => {
            await sealDraft(wallet, current);
            drafts.refresh();
            return "Sealed. Open it from here on any device with this passkey.";
          })
        }
      />
      {list.map((draft: SealedDraft) => (
        <View key={draft.id} style={styles.row}>
          <Text style={styles.when}>{new Date(draft.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</Text>
          <Button
            label={busy === draft.id ? "Opening…" : "Open"}
            variant="quiet"
            loading={busy === draft.id}
            disabled={busy !== null}
            onPress={() =>
              void act(draft.id, async () => {
                onOpen(await openDraft(draft));
                return "Opened from your passkey.";
              })
            }
          />
          <Button
            label="Delete"
            variant="quiet"
            disabled={busy !== null}
            onPress={() =>
              void act(`delete-${draft.id}`, async () => {
                await deleteDraft(wallet, draft.id);
                drafts.refresh();
                return "Deleted.";
              })
            }
          />
        </View>
      ))}
      {message ? <Text style={[styles.message, { color: message.tone === "pos" ? theme.colors.pos : theme.colors.neg }]}>{message.text}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  title: { fontSize: 15, fontWeight: "800", color: theme.colors.ink },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  when: { flex: 1, fontSize: 13, color: theme.colors.muted },
  message: { fontSize: theme.type.label.size, fontWeight: "600" },
});
