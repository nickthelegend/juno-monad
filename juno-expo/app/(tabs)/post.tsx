import { Image as ExpoImage } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
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
import { juno, MON_ADDRESS, type Venue } from "../../lib/api";
import { feedChanged } from "../../lib/refresh";
import { useTabBarHeight } from "../../lib/tabbar";
import { tokens, useApi } from "../../lib/useApi";
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
 * The launchpad deploys the token, opens its curve and locks the address of the
 * Uniswap v2 pair it will graduate into, all in one call — so there is no
 * half-launched state to explain. The server builds it as a list of steps anyway, because a
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

/** Where the curve goes when it fills. Offered as the server's config allows. */
const VENUES: Record<Venue, { label: string; blurb: string }> = {
  "uniswap-v2": {
    label: "Uniswap v2",
    blurb: "A constant-product pair. Every aggregator can route to it.",
  },
  kuru: {
    label: "Kuru order book",
    blurb: "Its own spot market on Monad's CLOB: limit orders, plus an AMM vault seeded with the curve.",
  },
};

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
  const [venue, setVenue] = useState<Venue>("uniswap-v2");
  /** MON the creator buys in the launch transaction itself. Zero for none. */
  const [firstBuy, setFirstBuy] = useState(0);
  // Kuru is offered where the server has a Kuru graduator; posts launch in MON,
  // which every offered venue takes.
  const config = useApi(() => juno.config(), []);
  const venues: Venue[] = (config.data?.venues ?? [{ id: "uniswap-v2" as const, name: "", quotes: [] }])
    .filter((option) => option.quotes.length === 0 || option.quotes.includes(MON_ADDRESS))
    .map((option) => option.id);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * What has actually happened, as it happens: each step with its receipt —
   * an IPFS address, a transaction hash, the token's address — and the time
   * it landed. Shown while the launch runs, so the chain's answers are on
   * screen rather than a spinner that says "trust me".
   */
  const [log, setLog] = useState<LogEntry[]>([]);
  const note = (entry: Omit<LogEntry, "at">) => setLog((current) => [...current, { ...entry, at: new Date() }]);
  // The log grows under the fold, beneath the tab bar; keep its newest row in
  // view, the way a terminal follows its output.
  const scroller = useRef<ScrollView>(null);
  const TAB_H = useTabBarHeight().height;
  useEffect(() => {
    if (log.length > 0) setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
  }, [log.length]);

  // A different format wants a different file: a photo for a post, a video
  // for a reel. Switching formats clears a pick of the wrong kind.
  useEffect(() => {
    if (media && (media.type === "video") !== (kind === "reel")) setMedia(null);
  }, [kind, media]);

  /*
   * MON for gas, checked before anything is uploaded or signed.
   *
   * A wallet with no MON could press Launch: the video was pinned, the
   * metadata pinned, the transaction signed — and only then did the node
   * refuse it for want of gas. The balance is read up front instead (and again
   * whenever the tab comes back into view, since MON usually arrives from the
   * profile's faucet in between), and the exact cost is checked again once the
   * transaction is built. Null means the read failed: that is not zero, and it
   * does not block.
   */
  const monBalance = useApi(
    () => (wallet.address ? juno.balance(wallet.address, MON_ADDRESS) : Promise.resolve(null)),
    [wallet.address],
  );
  useFocusEffect(
    useCallback(() => {
      monBalance.poll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet.address]),
  );
  const mon = monBalance.data?.balance ?? null;
  const testnet = (juno.loadedConfig()?.network ?? "monad-testnet") === "monad-testnet";
  const unfunded = wallet.address === null || (mon !== null && mon < firstBuy + LAUNCH_GAS_MON);

  const symbolOk = /^[A-Z0-9]{2,10}$/.test(symbol.trim().toUpperCase());
  const captionOk = caption.trim().length <= MAX_CAPTION;
  /*
   * Media is required. Every post in the feed is a picture and every reel is
   * a video; a launch without one produced a coin that drew as a placeholder
   * in the feed and — for a reel — never appeared in Reels at all.
   */
  const canLaunch = !!media && name.trim().length > 0 && symbolOk && captionOk && !unfunded && !busy;
  const missing = !media
    ? kind === "reel"
      ? "Add a video to launch"
      : "Add a photo to launch"
    : !name.trim()
      ? "Name it to launch"
      : !symbolOk
        ? // Said by which rule it breaks: "DAWN!" is within 2–10 characters,
          // and a hint about length left no clue what was wrong with it.
          /[^A-Za-z0-9]/.test(symbol.trim())
          ? "Tickers are letters and digits only"
          : "Add a 2–10 character ticker"
        : !captionOk
          ? "Caption is too long"
          : wallet.address === null
            ? `Launching needs a wallet with a little MON for gas.${testnet ? " Make one and get testnet MON on your profile." : ""}`
            : unfunded
              ? `This needs about ${firstBuy > 0 ? `${firstBuy} MON for the first buy plus ` : ""}${LAUNCH_GAS_MON} MON for gas, and the wallet has ${
                  mon === null ? "less" : tokens(mon)
                }.${testnet ? " Get testnet MON on your profile." : ""}`
              : null;

  async function pick() {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === "reel" ? ["videos"] : ["images"],
        // A JPEG, not the library's HEIC original: an iPhone photo is HEIC,
        // which a browser viewing the post cannot draw. A quality below 1
        // already makes iOS re-encode; `Compatible` says so explicitly.
        quality: 0.9,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
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
      note({ label: "Listed on Juno", receipt: record.token, link: "token" });
      setStatus("Live");
      feedChanged();
      // A beat on the finished log: every receipt is on screen at once, which
      // is the proof, before the coin page replaces it.
      await new Promise((resolve) => setTimeout(resolve, 3500));
      setStatus(null);
      // A blank composer for the next one. The tab stays mounted, so coming
      // back to it showed the last post filled in — one tap from launching a
      // duplicate coin.
      setMedia(null);
      setName("");
      setSymbol("");
      setCaption("");
      setPreset("content");
      setFirstBuy(0);
      setLog([]);
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
    setLog([]);
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

      note({ label: kind === "reel" ? "Video pinned to IPFS" : "Photo pinned to IPFS", receipt: uploaded.uri });
      if (uploaded.posterUri) note({ label: "Poster frame pinned", receipt: uploaded.posterUri });

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

      note({ label: "Token metadata pinned", receipt: metadata.uri });

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
        venue: venues.includes(venue) ? venue : "uniswap-v2",
        firstBuy: firstBuy > 0 ? firstBuy : undefined,
      });

      // The exact cost, now that it is known: every step's gas at its fee
      // cap, plus the first buy. Said before signing rather than learned from
      // the node's refusal after it.
      const cost = built.steps.reduce(
        (sum, step) => sum + BigInt(step.request.gas) * BigInt(step.request.maxFeePerGas) + BigInt(step.request.value),
        0n,
      );
      const held = await juno.balance(address, MON_ADDRESS).catch(() => null);
      if (held?.raw && BigInt(held.raw) < cost) {
        throw new Error(
          `This launch needs up to ${tokens(Number(cost) / 1e18)} MON with gas, and the wallet has ${tokens(
            Number(BigInt(held.raw)) / 1e18,
          )}.${testnet ? " Get testnet MON on your profile." : ""} Nothing was signed.`,
        );
      }

      const results = await wallet.signAndSubmit(
        built.steps,
        (step) =>
          setStatus(step.total > 1 ? `${step.label}… (${step.index + 1}/${step.total})` : `${step.label}…`),
        (result, step) =>
          note({
            // The last step is the launch itself; an earlier one is an approval.
            label:
              step.index === step.total - 1
                ? `Market opened on ${juno.loadedConfig()?.localFork ? "a local fork of Monad" : "Monad"}`
                : step.label,
            receipt: result.hash,
            link: "tx",
            confirmedInMs: result.confirmedInMs,
          }),
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
        <ScrollView
          ref={scroller}
          contentContainerStyle={[styles.body, { paddingBottom: TAB_H + 24 }]}
          showsVerticalScrollIndicator={false}
        >
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

          {venues.length > 1 ? (
            <>
              <Text style={styles.sectionTitle}>When it fills</Text>
              <Text style={styles.sectionLede}>
                The curve&apos;s reserves move to a venue and stay there for good. Chosen now, fixed at launch.
              </Text>
              <View style={styles.presets}>
                {venues.map((id) => {
                  const on = venue === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => setVenue(id)}
                      role="radio"
                      aria-checked={on}
                    >
                      <Card style={[styles.preset, on && styles.presetOn]}>
                        <View style={styles.presetHead}>
                          <Text style={styles.presetLabel}>{VENUES[id].label}</Text>
                          {on && <Pill label="Selected" tone="lime" />}
                        </View>
                        <Text style={styles.presetBlurb}>{VENUES[id].blurb}</Text>
                      </Card>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          <Text style={styles.sectionTitle}>Your first buy</Text>
          <Text style={styles.sectionLede}>
            Bought in the launch transaction itself, at the opening price, so nobody can get in ahead of you.
          </Text>
          <View style={styles.chips}>
            {FIRST_BUYS.map((amount) => {
              const on = firstBuy === amount;
              return (
                <Pressable
                  key={amount}
                  onPress={() => setFirstBuy(amount)}
                  role="radio"
                  aria-checked={on}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {amount === 0 ? "None" : `${amount} MON`}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {error && (
            <Card style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </Card>
          )}

          {log.length > 0 ? <LaunchLog entries={log} /> : null}

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
            {venue === "kuru"
              ? "One transaction: it deploys the token and opens its curve. The token cannot enter Kuru until the curve fills; then it opens its own Kuru market at the curve's final price. You pay the gas in MON."
              : "One transaction: it deploys the token, opens its curve, and reserves the Uniswap v2 pair the curve graduates into — locked until then. You pay the gas in MON."}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const MAX_CAPTION = 280;
/**
 * MON a launch is allowed to need for gas, checked before anything is pinned.
 *
 * Measured: a launch uses about 2.2M gas, and Monad charges the gas *limit* at
 * the fee cap — at testnet's 102 gwei on 2026-09-29 that is about 0.22 MON. On
 * a local fork (1 gwei) it is far less; the exact figure is checked again once
 * the transaction is built.
 */
const LAUNCH_GAS_MON = 0.25;
/** First-buy sizes offered at launch, in MON. */
const FIRST_BUYS = [0, 1, 5, 10] as const;
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

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

type LogEntry = {
  label: string;
  receipt: string;
  /** What the receipt opens on MonadVision, if anything. */
  link?: "tx" | "token";
  /** Broadcast to receipt, as the server measured it. */
  confirmedInMs?: number;
  at: Date;
};

function shorten(value: string): string {
  const bare = value.replace(/^ipfs:\/\//, "");
  return bare.length > 14 ? `${bare.slice(0, 6)}…${bare.slice(-6)}` : bare;
}

/** The launch, step by step, with each receipt and the second it landed. */
function LaunchLog({ entries }: { entries: LogEntry[] }) {
  return (
    <View style={styles.log}>
      {entries.map((entry, index) => (
        <Pressable
          key={`${entry.label}-${index}`}
          disabled={!entry.link || !juno.explorable()}
          onPress={() => entry.link && void Linking.openURL(juno.explorer(entry.link, entry.receipt))}
          style={styles.logRow}
          accessibilityRole={entry.link && juno.explorable() ? "link" : undefined}
        >
          <Text style={styles.logTick}>✓</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.logLabel}>{entry.label}</Text>
            <Text style={styles.logReceipt} numberOfLines={1}>
              {entry.link === "tx" ? "tx " : entry.link === "token" ? "token " : "ipfs "}
              {shorten(entry.receipt)}
              {entry.confirmedInMs !== undefined ? ` · ${(entry.confirmedInMs / 1000).toFixed(1)}s` : ""}
            </Text>
          </View>
          <Text style={styles.logTime}>
            {entry.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  body: { paddingHorizontal: 16, paddingBottom: 140, gap: 12 },
  log: {
    backgroundColor: theme.colors.ink,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  logRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  logTick: { color: theme.colors.lime, fontSize: 14, fontWeight: "900" },
  logLabel: { color: theme.colors.onInk, fontSize: 14, fontWeight: "700" },
  logReceipt: { color: "#9FB09A", fontSize: 12, fontFamily: MONO, marginTop: 2 },
  logTime: { color: "#9FB09A", fontSize: 12, fontFamily: MONO },
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
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: theme.colors.surfaceAlt,
  },
  chipOn: { backgroundColor: theme.colors.ink },
  chipText: { fontSize: theme.type.label.size, fontWeight: "700", color: theme.colors.text },
  chipTextOn: { color: theme.colors.onInk },
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
