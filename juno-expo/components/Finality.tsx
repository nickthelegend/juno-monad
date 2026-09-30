import { Text, View, StyleSheet } from "react-native";

import { COMMIT_STAGES, stageOffsets, useLive, type LiveEvent } from "../lib/live";
import { theme } from "../theme";

/**
 * Three dots that light up as Monad commits a block: proposed, voted,
 * finalized — each with the milliseconds it took, as the node reported them.
 *
 * Not an animation of a pretend pipeline. Every dot is a stage the server saw
 * arrive over Monad's WebSocket, and a dot stays hollow until it has.
 */
export function StageDots({
  event,
  compact = false,
  staged = true,
}: {
  event: LiveEvent;
  compact?: boolean;
  /** False on a single-node chain: one mark, final when mined. */
  staged?: boolean;
}) {
  if (!staged) {
    // A local fork has no proposal and no vote: the block is final the moment
    // it is mined. One filled mark says so; three dots would promise stages
    // that never happen.
    return (
      <View style={styles.row} accessibilityLabel="Mined and final on the local fork">
        <View style={styles.stage}>
          <View style={[styles.dot, styles.dotOn]} />
          {!compact ? <Text style={[styles.label, styles.labelOn]}>Final when mined</Text> : null}
        </View>
      </View>
    );
  }
  const offsets = stageOffsets(event);
  return (
    <View style={styles.row} accessibilityLabel={`Block ${event.state.toLowerCase()} on Monad`}>
      {offsets.map(({ stage, at }, index) => {
        const reached = at !== null;
        return (
          <View key={stage} style={styles.stage}>
            {index > 0 ? <View style={[styles.link, reached && styles.linkOn]} /> : null}
            <View style={[styles.dot, reached && styles.dotOn]} />
            {!compact ? (
              <Text style={[styles.label, reached && styles.labelOn]}>
                {stage}
                {reached && index > 0 ? ` ${at}ms` : ""}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * The finality of one transaction, followed live until it is final.
 * Renders nothing until the server has seen the transaction's block.
 */
export function FinalityTimeline({ txHash }: { txHash: string }) {
  const live = useLive(
    { tx: txHash },
    {
      intervalMs: 350,
      until: (snapshot) => snapshot.events.some((event) => event.stages.Finalized !== undefined),
      // The server follows the chain's own stream: Monad's, or on a local
      // fork the fork node's. A block is final in about a second either way,
      // so fifteen seconds without it means the stream missed it and asking
      // again will not help.
      forMs: 15_000,
    },
  );
  const event = live?.events[0];
  if (!event) return null;
  if (live?.staged === false) {
    return (
      <View style={styles.timeline}>
        <StageDots event={event} staged={false} />
        <Text style={styles.caption}>
          {`Mined in block ${event.blockNumber.toLocaleString("en-US")} — final at once: a local fork is one node, with no vote to wait for.`}
        </Text>
      </View>
    );
  }
  const finalized = event.stages.Finalized;
  const proposed = event.stages.Proposed;
  return (
    <View style={styles.timeline}>
      <StageDots event={event} />
      {finalized !== undefined && proposed !== undefined ? (
        <Text style={styles.caption}>{`Final on Monad ${finalized - proposed}ms after it was proposed.`}</Text>
      ) : null}
    </View>
  );
}

export const STAGE_COUNT = COMMIT_STAGES.length;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  stage: { flexDirection: "row", alignItems: "center", gap: 6 },
  link: { width: 18, height: 2, borderRadius: 1, backgroundColor: theme.colors.line, marginHorizontal: 4 },
  linkOn: { backgroundColor: theme.colors.pos },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.colors.lineStrong,
    backgroundColor: theme.colors.surface,
  },
  dotOn: { borderColor: theme.colors.pos, backgroundColor: theme.colors.pos },
  label: { fontSize: theme.type.micro.size, color: theme.colors.faint, fontWeight: "600" },
  labelOn: { color: theme.colors.text },
  timeline: {
    marginTop: theme.space(3),
    padding: theme.space(3),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    gap: theme.space(2),
    alignItems: "center",
  },
  caption: { fontSize: theme.type.caption.size, color: theme.colors.muted, textAlign: "center" },
});
