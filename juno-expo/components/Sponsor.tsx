import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../theme";

/**
 * Which Monad-native partner did the work, said where it happened.
 *
 * Kuru, Chainlink CRE, Mera, Agora and Perpl are each in the product, but
 * the evidence used to live in docs and in a sentence or two of grey text.
 * A badge sits on the thing the partner did: the receipt of a fill on Kuru's
 * book, the NAV a CRE workflow attested, the passkey that signed, the AUSD a
 * position is margined in. It is shown only when that is true of what is on
 * screen; nothing here is decoration. With `href` it opens the evidence (the
 * market, the oracle, the transaction).
 *
 * One quiet style for all of them: the partner's name is the signal, set in
 * the app's own ink, not a borrowed logo.
 */
export type Sponsor = "kuru" | "chainlink" | "mera" | "agora" | "perpl";

const NAMES: Record<Sponsor, { name: string; mark: string }> = {
  kuru: { name: "Kuru", mark: "K" },
  chainlink: { name: "Chainlink CRE", mark: "C" },
  mera: { name: "Mera", mark: "M" },
  agora: { name: "Agora", mark: "A" },
  perpl: { name: "Perpl", mark: "P" },
};

export function SponsorBadge({
  sponsor,
  claim,
  detail,
  href,
}: {
  sponsor: Sponsor;
  /** What the partner did, in a few words: "Filled on Kuru". */
  claim: string;
  /** A fact that backs it: "order book", "12s ago". */
  detail?: string;
  href?: string | null;
}) {
  const { mark, name } = NAMES[sponsor];
  const body = (
    <View style={styles.badge} testID={`sponsor-${sponsor}`} accessibilityLabel={`${claim}${detail ? `, ${detail}` : ""}`}>
      <View style={styles.mark}>
        <Text style={styles.markText}>{mark}</Text>
      </View>
      <Text style={styles.claim} numberOfLines={1}>
        {claim}
        {detail ? <Text style={styles.detail}>{` · ${detail}`}</Text> : null}
      </Text>
      {href ? <Text style={styles.arrow}>↗</Text> : null}
    </View>
  );
  if (!href) return body;
  return (
    <Pressable onPress={() => void Linking.openURL(href)} accessibilityRole="link" accessibilityHint={`Opens ${name}'s record`}>
      {body}
    </Pressable>
  );
}

/** Badges in a wrapping row, centred or start-aligned. */
export function SponsorRow({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return <View style={[styles.row, center ? { justifyContent: "center" } : null]}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
    paddingLeft: 4,
    paddingRight: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.lineStrong,
    alignSelf: "flex-start",
    maxWidth: "100%",
  },
  mark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { color: theme.colors.lime, fontSize: 10, fontWeight: "900" },
  claim: { fontSize: 12, fontWeight: "800", color: theme.colors.text, flexShrink: 1 },
  detail: { fontWeight: "600", color: theme.colors.muted },
  arrow: { fontSize: 11, fontWeight: "800", color: theme.colors.muted },
});
