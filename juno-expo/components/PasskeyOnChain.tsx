import { useState } from "react";
import { StyleSheet, Text } from "react-native";

import { Button, Card } from "./kit";
import { juno } from "../lib/api";
import { assertMeraPasskey, meraPasskey, passkeyLinkMessage } from "../lib/mera";
import { useApi } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * A passkey account, proved on Monad.
 *
 * The passkey signs a challenge from Juno's server, the wallet signs that
 * the passkey is its own, and the server sends the passkey's signature to
 * Monad's P256 precompile (0x…0100) with `eth_call`: the chain's own code
 * says whether it is valid, the same check a contract can make. A wallet
 * that passes shows "Passkey verified on Monad" on its profile.
 */
export function PasskeyOnChain({ wallet }: { wallet: string }) {
  const signer = useWallet();
  const passkey = meraPasskey();
  const profile = useApi(() => juno.profile(wallet), [wallet]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "pos" | "neg"; text: string } | null>(null);
  const linked = profile.data?.passkey ?? null;

  const prove = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const { challenge } = await juno.passkeyChallenge(wallet);
      const assertion = await assertMeraPasskey(challenge);
      const keyHex = `0x${assertion.publicKey.x.slice(2)}${assertion.publicKey.y.slice(2)}`;
      const walletSignature = await signer.signMessage(passkeyLinkMessage(wallet, keyHex, challenge));
      const verified = await juno.verifyPasskey({ wallet, challenge, walletSignature, ...assertion });
      setResult({
        tone: "pos",
        text: `Verified by Monad's P256 precompile (0x…0100) on ${verified.where === "monad" ? "Monad" : "this local fork of Monad testnet"}.`,
      });
      profile.refresh();
    } catch (caught) {
      setResult({ tone: "neg", text: caught instanceof Error ? caught.message : "The passkey could not be proved." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="passkey-on-chain">
      <Text style={styles.kicker}>Passkey on Monad</Text>
      <Text style={styles.line}>
        {linked
          ? `Verified ${new Date(linked.verifiedAt).toLocaleString()} by Monad's P256 precompile${linked.where === "local fork" ? " on this local fork" : ""}. Your profile shows it.`
          : passkey
            ? "Prove this account is a passkey: it signs a challenge, and Monad's own P256 precompile (0x…0100) checks the signature."
            : "This passkey account was made before Juno kept passkey public keys, so there is nothing for Monad to check. A new passkey account can be proved."}
      </Text>
      {passkey ? (
        <Button
          label={linked ? "Prove it again" : "Prove my passkey on Monad"}
          variant={linked ? "quiet" : "ink"}
          onPress={() => void prove()}
          loading={busy}
          style={{ marginTop: 12, alignSelf: "stretch" }}
        />
      ) : null}
      {result ? (
        <Text testID="passkey-result" style={[styles.line, { marginTop: 8, color: result.tone === "pos" ? theme.colors.pos : theme.colors.neg }]}>
          {result.text}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase", color: theme.colors.muted },
  line: { fontSize: 13, lineHeight: 19, color: theme.colors.text, marginTop: 4 },
});
