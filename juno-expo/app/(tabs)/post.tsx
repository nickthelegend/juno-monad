import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CurvePreview } from "../../components/CurvePreview";
import { Button, Card, Pill } from "../../components/kit";
import { juno, MON_ADDRESS } from "../../lib/api";
import { feedChanged } from "../../lib/refresh";
import { useWallet } from "../../lib/wallet";
import { theme } from "../../theme";

/**
 * Post — which here means launching a real market.
 *
 * This is Juno's whole claim in one screen. Publishing does not create a row in
 * a table; it deploys a token on Monad with a sixteen-segment bonding curve
 * chosen from a preset, and the post *is* that market.
 *
 * ## One transaction
 *
 * The launchpad deploys the token, opens its curve and creates the Uniswap v2
 * pair it will graduate into, all in one call — so there is no half-launched
 * state to explain. The server builds it as a list of steps anyway, because a
 * launch that opens with a first buy in USDC needs an approval first; the
 * wallet signs every step and submits them in order.
 *
 * ## Listing is a second, separate act
 *
 * Once the transaction confirms, the coin exists on-chain whether or not Juno
 * has indexed it. Indexing can fail on its own — a database blip — and when it
 * does the screen keeps everything needed to retry it without signing again,
 * rather than leaving a creator with a live market that appears nowhere.
 */

const PRESETS = [
  {
    id: "content",
    label: "Content",
    blurb: "Back-loaded. Cheap to enter, steepens as attention arrives.",
  },
  {
    id: "thin-name",
    label: "Thin name",
    blurb: "Front-loaded. Deep at the issue price so early size fills.",
  },
  {
    id: "ipo-book",
    label: "IPO book",
    blurb: "Deep at both ends, thin in the middle. Book-building.",
  },
  {
    id: "tight-nav",
    label: "Tight NAV",
    blurb: "Uniform. Tracks an underlying like a spread, not a launch.",
  },
] as const;

export default function PostScreen() {
  const router = useRouter();
  const wallet = useWallet();
  /*
   * Which kind of thing is being launched, chosen in the create sheet.
   *
   * It was hardcoded to "post", so the phone could not launch a reel at all
   * while the web could — and a reel is a different object in the feed, not a
   * cosmetic label: it decides whether this lands in the grid or the swipe
   * feed. Defaulting to "post" keeps a direct visit to this route working.
   */
  const { format } = useLocalSearchParams<{ format?: string }>();
  const kind: "post" | "reel" = format === "reel" ? "reel" : "post";

  const [media, setMedia] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [caption, setCaption] = useState("");
  /** A launch that confirmed on-chain but could not be listed yet — kept so listing can be retried. */
  const [unlisted, setUnlisted] = useState<Parameters<typeof juno.recordLaunch>[0] | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [preset, setPreset] = useState<string>("content");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A different format wants a different file: a photo for a post, a video
  // for a reel. Switching formats clears a pick of the wrong kind.
  useEffect(() => {
    if (media && (media.type === "video") !== (kind === "reel")) setMedia(null);
  }, [kind, media]);

  const symbolOk = /^[A-Z0-9]{2,10}$/.test(symbol.trim().toUpperCase());
  const captionOk = caption.trim().length <= MAX_CAPTION;
  /*
   * Media is required. Every post in the feed is a picture and every reel is
   * a video; a launch without one produced a coin that drew as a placeholder
   * in the feed and — for a reel — never appeared in Reels at all.
   */
  const canLaunch = !!media && name.trim().length > 0 && symbolOk && captionOk && !busy;
  const missing = !media
    ? kind === "reel"
      ? "Add a video to launch"
      : "Add a photo to launch"
    : !name.trim()
      ? "Name it to launch"
      : !symbolOk
        ? "Add a 2–10 character ticker"
        : !captionOk
          ? "Caption is too long"
          : null;

  async function pick() {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === "reel" ? ["videos"] : ["images"],
        quality: 0.9,
        videoMaxDuration: 90,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_BYTES) {
        setError("That file is over 25MB. Pick a smaller one.");
        return;
      }
      setMedia(asset);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open your library");
    }
  }

  /** Index a confirmed launch. Throws with a reason the screen can show. */
  async function list(record: Parameters<typeof juno.recordLaunch>[0]) {
    setStatus("Listing it on Juno…");
    try {
      await juno.recordLaunch(record);
      setUnlisted(null);
      setStatus(null);
      feedChanged();
      router.push(`/coin/${record.token}`);
    } catch (caught) {
      setUnlisted(record);
      setStatus(null);
      throw new Error(
        `Your coin is live on-chain, but Juno could not list it yet: ${
          caught instanceof Error ? caught.message : "unknown error"
        }. Tap "Retry listing" — nothing needs signing again.`,
      );
    }
  }

  async function retryListing() {
    if (!unlisted) return;
    setBusy(true);
    setError(null);
    try {
      await list(unlisted);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Listing failed");
    } finally {
      setBusy(false);
    }
  }

  async function launch() {
    if (!media) return;
    setBusy(true);
    setError(null);
    try {
      const address = wallet.address ?? (await wallet.connect());

      setStatus(kind === "reel" ? "Uploading your video…" : "Uploading your photo…");
      const uploaded = await juno.upload(
        media.file ?? {
          uri: media.uri,
          name: media.fileName ?? (media.type === "video" ? "reel.mp4" : "post.jpg"),
          type: media.mimeType ?? (media.type === "video" ? "video/mp4" : "image/jpeg"),
        },
      );

      setStatus("Pinning the token metadata…");
      const metadata = await juno.pinMetadata({
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        description: caption.trim() || undefined,
        curvePreset: preset,
        // Wallets and explorers want a still; a reel's is its poster.
        imageUrl: uploaded.posterUrl ?? uploaded.url,
        mimeType: uploaded.posterUrl ? "image/jpeg" : uploaded.mimeType,
      });

      setStatus("Building the launch…");
      const built = await juno.buildLaunch({
        creator: address,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        preset,
        uri: metadata.uri,
        // Posts launch against native MON: nothing to approve, and the
        // currency every wallet here already holds for gas.
        quoteToken: MON_ADDRESS,
      });

      const results = await wallet.signAndSubmit(built.steps, (step) =>
        setStatus(step.total > 1 ? `${step.label}… (${step.index + 1}/${step.total})` : `${step.label}…`),
      );
      // The launch is the last step, and its hash is the receipt a judge
      // clicks. The token address comes from the chain's own `Launched`
      // event; the launchpad's prediction is the fallback, and they agree.
      const launch = results[results.length - 1];
      const token = results.find((result) => result.launched)?.launched?.token ?? built.token;

      /*
       * The coin exists on-chain from here on. Listing it used to fail
       * silently, which left a creator with a live market that appeared
       * nowhere in the app and no idea why. Now a failure says so and keeps
       * everything needed to retry without signing again.
       */
      await list({
        token,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        format: kind,
        curvePreset: preset,
        createTx: launch.hash,
        description: caption.trim() || null,
        mediaUrl: uploaded.uri,
        posterUrl: uploaded.posterUri ?? uploaded.uri,
        mediaMime: uploaded.mimeType,
        mediaWidth: uploaded.width,
        mediaHeight: uploaded.height,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Launch failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>
            {kind === "reel" ? "Post a reel" : "Post a photo"}
          </Text>
          <Text style={styles.lede}>
            {kind === "reel"
              ? "A vertical video with a real bonding curve behind it on Monad. It lands in the swipe feed."
              : "Publishing opens a real bonding curve on Monad. The post is the market."}
          </Text>

          <MediaPicker kind={kind} media={media} onPick={pick} disabled={busy} />

          <Card style={styles.form}>
            <Field label="Name">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Night Market"
                placeholderTextColor={theme.colors.faint}
                style={styles.input}
                maxLength={64}
              />
            </Field>

            <Field label="Ticker" hint={symbol.length > 0 && !symbolOk ? "2–10 letters or digits" : undefined}>
              <TextInput
                value={symbol}
                onChangeText={(next) => setSymbol(next.toUpperCase())}
                placeholder="NIGHT"
                placeholderTextColor={theme.colors.faint}
                autoCapitalize="characters"
                style={styles.input}
                maxLength={10}
              />
            </Field>

            <Field
              label="Caption"
              hint={!captionOk ? `${caption.trim().length - MAX_CAPTION} over the limit` : undefined}
            >
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder={kind === "reel" ? "Street level, 2am." : "Say what this is"}
                placeholderTextColor={theme.colors.faint}
                multiline
                style={[styles.input, styles.caption]}
                maxLength={MAX_CAPTION + 20}
              />
            </Field>
          </Card>

          <Text style={styles.sectionTitle}>Curve</Text>
          <Text style={styles.sectionLede}>
            Sixteen liquidity-weighted segments. The weights decide how the price
            behaves, not just where it starts.
          </Text>

          <View style={styles.presets}>
            {PRESETS.map((option) => {
              const on = preset === option.id;
              return (
                <Pressable key={option.id} onPress={() => setPreset(option.id)}>
                  <Card style={[styles.preset, on && styles.presetOn]}>
                    <View style={styles.presetRow}>
                      <View style={styles.presetText}>
                        <View style={styles.presetHead}>
                          <Text style={styles.presetLabel}>{option.label}</Text>
                          {on && <Pill label="Selected" tone="lime" />}
                        </View>
                        <Text style={styles.presetBlurb}>{option.blurb}</Text>
                      </View>
                      {/* The curve itself, drawn from the same sixteen weights
                          the launch uses. The weights are the whole decision. */}
                      <CurvePreview preset={option.id} active={on} />
                    </View>
                  </Card>
                </Pressable>
              );
            })}
          </View>

          {error && (
            <Card style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </Card>
          )}

          {unlisted ? (
            <Button label={status ?? "Retry listing"} tall onPress={retryListing} loading={busy} />
          ) : (
            <Button
              label={status ?? (kind === "reel" ? "Launch reel" : "Launch post")}
              tall
              onPress={launch}
              loading={busy}
              disabled={!canLaunch}
            />
          )}
          {/* Why the button is off, instead of a dead button and a guess. */}
          {!busy && !unlisted && missing ? <Text style={styles.missing}>{missing}</Text> : null}
          {busy && status ? <Text style={styles.missing}>{status}</Text> : null}
          <Text style={styles.footnote}>
            One transaction: it deploys the token, opens its curve, and creates
            the Uniswap v2 pair the curve graduates into — locked until then.
            You pay the gas in MON.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const MAX_CAPTION = 280;
/** Matches the upload route's own limit, so a doomed upload is refused before it starts. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The photo or video, picked from the library and previewed at its own shape.
 *
 * A reel previews playing and muted, the way it will sit in the feed, so the
 * creator sees what everyone else will before they sign for it.
 */
function MediaPicker({
  kind,
  media,
  onPick,
  disabled,
}: {
  kind: "post" | "reel";
  media: ImagePicker.ImagePickerAsset | null;
  onPick: () => void;
  disabled: boolean;
}) {
  if (!media) {
    return (
      <Pressable onPress={onPick} disabled={disabled} accessibilityRole="button">
        <View style={[styles.drop, { aspectRatio: kind === "reel" ? 4 / 5 : 1 }]}>
          <View style={styles.dropDisc}>
            <Text style={styles.dropPlus}>+</Text>
          </View>
          <Text style={styles.dropTitle}>{kind === "reel" ? "Add a video" : "Add a photo"}</Text>
          <Text style={styles.dropBlurb}>
            {kind === "reel" ? "Vertical works best. Up to 25MB." : "Square works best. Up to 25MB."}
          </Text>
        </View>
      </Pressable>
    );
  }

  const ratio =
    media.width && media.height ? Math.max(0.56, Math.min(1.25, media.width / media.height)) : 1;

  return (
    <View style={[styles.preview, { aspectRatio: ratio }]}>
      {media.type === "video" ? (
        <VideoPreview uri={media.uri} />
      ) : (
        <ExpoImage source={{ uri: media.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      <Pressable onPress={onPick} disabled={disabled} style={styles.change} accessibilityRole="button">
        <Text style={styles.changeText}>Change</Text>
      </Pressable>
    </View>
  );
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = true;
    instance.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
    />
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  body: { paddingHorizontal: 16, paddingBottom: 140, gap: 12 },
  title: { fontSize: theme.type.screen.size, fontWeight: "800", color: theme.colors.ink },
  lede: { fontSize: theme.type.body.size, color: theme.colors.muted, lineHeight: 21 },
  form: { gap: 16 },
  fieldLabel: { fontSize: theme.type.label.size, fontWeight: "500", color: theme.colors.muted },
  fieldHint: { fontSize: theme.type.micro.size, fontWeight: "500", color: theme.colors.neg },
  input: {
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 16,
    fontSize: theme.type.body.size,
    color: theme.colors.text,
  },
  sectionTitle: { fontSize: theme.type.title.size, fontWeight: "700", color: theme.colors.text, marginTop: 8 },
  sectionLede: { fontSize: theme.type.label.size, fontWeight: "500", color: theme.colors.muted, lineHeight: 19 },
  presets: { gap: 8 },
  preset: { gap: 6, padding: 16 },
  presetOn: { borderWidth: 2, borderColor: theme.colors.lime },
  presetRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  presetText: { flex: 1, gap: 6 },
  presetHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  presetLabel: { fontSize: theme.type.body.size, fontWeight: "600", color: theme.colors.ink },
  presetBlurb: { fontSize: theme.type.label.size, fontWeight: "500", color: theme.colors.muted, lineHeight: 19 },
  errorCard: { backgroundColor: "rgba(217,45,32,0.08)" },
  errorText: { fontSize: theme.type.body.size, color: theme.colors.neg, lineHeight: 21 },
  caption: { height: 88, paddingTop: 12, textAlignVertical: "top" },
  missing: { fontSize: theme.type.label.size, fontWeight: "600", color: theme.colors.muted, textAlign: "center" },
  drop: {
    width: "100%",
    borderRadius: theme.radius.lg,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: theme.colors.lineStrong,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  dropDisc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.lime,
  },
  dropPlus: { fontSize: 30, fontWeight: "600", color: theme.colors.onLime, marginTop: -3 },
  dropTitle: { fontSize: theme.type.body.size, fontWeight: "800", color: theme.colors.text },
  dropBlurb: { fontSize: theme.type.label.size, color: theme.colors.muted },
  preview: {
    width: "100%",
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.ink,
  },
  change: {
    position: "absolute",
    right: 12,
    bottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  changeText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  footnote: { fontSize: theme.type.micro.size, fontWeight: "500", color: theme.colors.faint, lineHeight: 16, marginTop: 8 },
});
