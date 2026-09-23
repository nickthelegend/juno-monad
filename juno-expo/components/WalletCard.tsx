import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Linking, StyleSheet, Text, TextInput, View } from "react-native";

import { Tappable } from "./Press";
import { Button } from "./kit";
import { api, juno, MON_ADDRESS, networkLabel } from "../lib/api";
import { rememberName, useName } from "../lib/names";
import { useWallet } from "../lib/wallet";
import { useApi } from "../lib/useApi";
import { theme } from "../theme";

/** Monad's own faucet — where to go when Juno's is dry or refusing. */
const MONAD_FAUCET = "https://faucet.monad.xyz";
/** Circle's, for testnet USDC. Juno's faucet only sends MON. */
const CIRCLE_FAUCET = "https://faucet.circle.com";

/**
 * The wallet itself: its address, what it holds, and how to fund it.
 *
 * The profile used to show a shortened address and nothing else — no way to
 * copy it, no balance, no way to get the testnet MON every action costs in
 * gas. A new user could browse everything and do nothing, with no hint as to
 * why.
 *
 * Balances are read from chain and shown as a dash when the read fails, never
 * as zero: "0 MON" on a throttled read would tell someone to go and fund a
 * wallet that is already funded.
 *
 * ## Funding
 *
 * On testnet the server keeps a faucet key and sends a little MON on request.
 * When it is dry, rate-limited or switched off, Monad's official faucet is one
 * tap away instead of being a dead end. USDC is Circle's to give, so the card
 * points there rather than pretending Juno can. On mainnet there is no faucet
 * and the card offers none.
 */
export function WalletCard({ address }: { address: string }) {
  const config = useApi(() => juno.config(), []);
  const network = config.data?.network ?? "monad-testnet";
  const testnet = network === "monad-testnet";

  const mon = useApi(() => juno.balance(address, MON_ADDRESS), [address]);
  // Which USDC depends on the network, so it waits for the config — and falls
  // back to the known address when an older server has no config to give.
  const usdc = useApi(async () => {
    await juno.config().catch(() => null);
    return juno.balance(address, juno.quoteToken("USDC").address);
  }, [address]);
  const [copied, setCopied] = useState(false);
  const [funding, setFunding] = useState(false);
  const [message, setMessage] = useState<{ tone: "pos" | "neg"; text: string; url?: string } | null>(null);

  const copy = async () => {
    await Clipboard.setStringAsync(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const fund = async () => {
    setFunding(true);
    setMessage(null);
    try {
      const result = await juno.faucet(address);
      // The server answers once the transfer is in a block. Monad will not
      // let a freshly funded account send for about a second after that,
      // which is less time than it takes to get from here to a Buy button.
      setMessage({ tone: "pos", text: `${result.amount} ${result.symbol} received.` });
      mon.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "The faucet did not answer.";
      setMessage({
        tone: "neg",
        text: `${text.trim().replace(/[.!]?$/, ".")} Monad's own faucet works too.`,
        url: MONAD_FAUCET,
      });
    } finally {
      setFunding(false);
    }
  };

  const figure = (state: typeof mon) =>
    state.loading ? "…" : state.data?.balance === null || state.data === null || state.error ? "—" : state.data.balance.toFixed(state.data.balance < 1 ? 4 : 2);

  const empty = mon.data?.balance === 0;
  // Unknown is not "no faucet": only a config that says so hides Juno's.
  const serverFaucet = testnet && config.data?.faucet !== false;

  return (
    <View style={styles.card}>
      <NameEditor address={address} />
      <View style={styles.head}>
        <Text style={styles.label}>Wallet · {networkLabel(network)}</Text>
        <Tappable onPress={() => void copy()} to={0.95} accessibilityRole="button" accessibilityLabel="Copy address">
          <View style={styles.copy}>
            <Text style={styles.copyText}>{copied ? "Copied" : "Copy address"}</Text>
          </View>
        </Tappable>
      </View>
      <Text style={styles.address} selectable numberOfLines={1} ellipsizeMode="middle">
        {address}
      </Text>

      <View style={styles.balances}>
        <View style={styles.balance}>
          <Text style={styles.amount}>{figure(mon)}</Text>
          <Text style={styles.unit}>MON</Text>
        </View>
        <View style={styles.rule} />
        <View style={styles.balance}>
          <Text style={styles.amount}>{figure(usdc)}</Text>
          <Text style={styles.unit}>USDC</Text>
        </View>
      </View>

      {empty ? (
        <Text style={styles.hint}>Every buy and launch pays gas in MON. Fund this wallet to start.</Text>
      ) : null}

      {serverFaucet ? (
        <Button
          label={funding ? "Asking the faucet…" : "Get testnet MON"}
          variant={empty ? "lime" : "quiet"}
          loading={funding}
          onPress={() => void fund()}
        />
      ) : testnet ? (
        <Button
          label="Open the Monad faucet"
          variant={empty ? "lime" : "quiet"}
          onPress={() => void Linking.openURL(MONAD_FAUCET)}
        />
      ) : null}

      {message ? (
        <Text style={[styles.message, { color: message.tone === "pos" ? theme.colors.pos : theme.colors.neg }]}>
          {message.text}
          {message.url ? (
            <Text style={styles.link} onPress={() => void Linking.openURL(message.url!)}>
              {"  "}Open faucet
            </Text>
          ) : null}
        </Text>
      ) : null}

      {testnet ? (
        <Text style={styles.hint}>
          Testnet USDC comes from Circle.
          <Text style={styles.link} onPress={() => void Linking.openURL(CIRCLE_FAUCET)}>
            {"  "}Get USDC
          </Text>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    padding: 16,
    gap: 12,
    ...theme.shadow.card,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 12, fontWeight: "700", color: theme.colors.muted, letterSpacing: 0.2 },
  copy: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.surfaceAlt },
  copyText: { fontSize: 12, fontWeight: "700", color: theme.colors.text },
  address: { fontSize: 13, fontWeight: "600", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  balances: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  balance: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
  amount: { fontSize: 20, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  unit: { fontSize: 12, fontWeight: "700", color: theme.colors.muted },
  rule: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: theme.colors.lineStrong, marginHorizontal: 12 },
  hint: { fontSize: 13, lineHeight: 18, color: theme.colors.muted },
  message: { fontSize: 13, lineHeight: 18 },
  link: { fontWeight: "800", color: theme.colors.focus },
  name: { fontSize: 17, fontWeight: "800", color: theme.colors.text, marginTop: 2 },
  choose: { backgroundColor: theme.colors.lime },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  at: { fontSize: 16, fontWeight: "800", color: theme.colors.muted, marginRight: 2 },
  nameInput: { flex: 1, fontSize: 16, fontWeight: "700", color: theme.colors.text },
});

/**
 * Claim a name. Signed by this wallet, so nobody can take yours or rename
 * you; checked and stored by the server, so everyone sees the same one.
 */
function NameEditor({ address }: { address: string }) {
  const wallet = useWallet();
  const current = useName(address);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleaned = draft.trim().toLowerCase();
  const valid = /^[a-z0-9_]{3,20}$/.test(cleaned);

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const issuedAt = new Date().toISOString();
      // Exactly the text the server rebuilds and verifies — see
      // `nameMessage` in lib/juno/profiles.ts. It rebuilds it from the
      // `wallet` sent below, character for character, so both use `address`.
      const message = `Juno name: ${cleaned}\nWallet: ${address}\nIssued: ${issuedAt}`;
      // EIP-191 `personal_sign`: the server recovers the signer from this and
      // compares it with `wallet`.
      const signature = await wallet.signMessage(message);
      const result = await api.post<{ name: string }>("/api/juno/profiles", {
        wallet: address,
        name: cleaned,
        issuedAt,
        signature,
      });
      rememberName(address, result.name);
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That name could not be saved");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.name}>{current ? `@${current}` : "No name yet"}</Text>
        </View>
        <Tappable
          onPress={() => {
            setDraft(current ?? "");
            setEditing(true);
          }}
          to={0.95}
          accessibilityRole="button"
          accessibilityLabel={current ? "Change your name" : "Choose a name"}
        >
          <View style={[styles.copy, !current ? styles.choose : null]}>
            <Text style={styles.copyText}>{current ? "Change" : "Choose a name"}</Text>
          </View>
        </Tappable>
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>Name</Text>
      <View style={styles.nameRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          value={draft}
          onChangeText={(next) => setDraft(next.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20))}
          placeholder="yourname"
          placeholderTextColor={theme.colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          style={styles.nameInput}
          onSubmitEditing={() => void save()}
        />
      </View>
      <Text style={[styles.hint, error ? { color: theme.colors.neg } : null]}>
        {error ?? (draft && !valid ? "3–20 letters, digits or underscores." : "Your wallet signs to claim it. Free, no transaction.")}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button label="Cancel" variant="quiet" onPress={() => setEditing(false)} style={{ flex: 1 }} />
        <Button label="Save" onPress={() => void save()} loading={saving} disabled={!valid} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
