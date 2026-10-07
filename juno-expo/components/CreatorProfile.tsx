import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import styled from "styled-components/native";

import { BottomSheet } from "./BottomSheet";
import { Earnings } from "./Earnings";
import { CoinArt, Identicon } from "./art";
import { ReelBadgeGlyph, ShareGlyph } from "./icons";
import { Tappable } from "./Press";
import { QuickTrade } from "./QuickTrade";
import { TradeList } from "./TradeList";
import {
  Body,
  Button,
  Caption,
  Card,
  Chevron,
  ChevronLeft,
  Col,
  Delta,
  Entry,
  ExternalGlyph,
  Label,
  Ledger,
  Mono,
  Pill,
  Placeholder,
  Row,
  Skeleton,
  Stat,
} from "./kit";
import { sameAddress } from "../lib/address";
import { api, juno, type Coin, type CreatorProfile as Profile, type Position } from "../lib/api";
import { useRefreshOnFocus } from "../lib/focus";
import { useLinkedState } from "../lib/linked";
import { detailsMessage, rememberName, shortAddress } from "../lib/names";
import { shareProfile } from "../lib/social";
import { money, tokens, useApi } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * A creator's profile, laid out the way people already read one.
 *
 * The header says who they are (avatar, name, bio, link) and how many people
 * care (posts, followers, following, and what their coins are worth). Under it
 * the work itself: every post they launched as a square in a three-column
 * grid, each carrying its coin's price change, because on Juno a post *is* a
 * market and the grid is their portfolio of launches.
 *
 * One component, two views. Your own profile edits (name, bio and link, each
 * signed by the wallet) and keeps the wallet itself one tab away. Anyone
 * else's offers Follow and a buy of their biggest coin. Every figure is read
 * from the API and the chain; a number that could not be read is a dash.
 */

type Tab = "posts" | "reels" | "coins" | "backed" | "wallet";
const VISITOR_TABS: readonly Tab[] = ["posts", "reels", "coins", "backed"];
const OWN_TABS: readonly Tab[] = ["posts", "reels", "coins", "backed", "wallet"];

export function CreatorProfile({
  wallet,
  own,
  onBack,
  walletTab,
  onRefresh,
}: {
  /** Checksummed address. */
  wallet: string;
  /** This is the signed-in wallet's own profile. */
  own: boolean;
  /** Shown as a back arrow in the top bar when set. */
  onBack?: () => void;
  /** The own profile's Wallet tab: balances, signer, portfolio, plans. */
  walletTab?: ReactNode;
  /** Called on pull-to-refresh, after the profile itself re-reads. */
  onRefresh?: () => void;
}) {
  const router = useRouter();
  const me = useWallet();
  // The Wallet tab exists only where there is a wallet view to put in it.
  const allowed = own && walletTab ? OWN_TABS : VISITOR_TABS;
  const [tab, setTab] = useLinkedState<Tab>("tab", allowed, "posts");

  const profile = useApi(() => juno.profile(wallet, me.address), [wallet, me.address]);
  const data = profile.data;
  // A launch, a buy or a follow made elsewhere shows here on return.
  useRefreshOnFocus(() => profile.refresh());

  const created = data?.coins ?? [];
  // The main grid is every post, photos and reels together, newest first, as
  // Instagram's is; a reel carries its badge. Trackers are coins, not posts,
  // and are listed under Coins. The header's count is this grid's length.
  const posts = useMemo(
    () => created.filter((coin) => !coin.reference && (coin.format === "post" || coin.format === "reel")),
    [created],
  );
  const reels = useMemo(() => created.filter((coin) => coin.format === "reel"), [created]);
  const createdSet = useMemo(() => new Set(created.map((coin) => coin.address.toLowerCase())), [created]);

  // What they hold, and their record, are read only once the Backed tab is
  // open: both walk pools, and most visits are to look at the grid.
  const backedOpen = tab === "backed";
  const portfolio = useApi(() => (backedOpen ? juno.portfolio(wallet) : Promise.resolve(null)), [wallet, backedOpen]);
  const board = useApi(() => (backedOpen ? juno.leaderboard(50) : Promise.resolve(null)), [backedOpen]);

  const [follows, setFollows] = useState<boolean | null>(null);
  const [followers, setFollowers] = useState<number | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState<Coin | null>(null);
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    // No wallet yet means "not following": Follow makes the wallet on the way.
    setFollows(data.viewerFollows ?? (me.address ? null : false));
    setFollowers(data.followers);
  }, [data, me.address]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  /** Follow, optimistically; the button and the count roll back together. */
  const toggleFollow = useCallback(async () => {
    if (follows === null || saving) return;
    const next = !follows;
    const before = { follows, followers };
    setSaving(true);
    setFollowError(null);
    setFollows(next);
    setFollowers((count) => (count === null ? count : Math.max(0, count + (next ? 1 : -1))));
    try {
      const address = me.address ?? (await me.connect());
      const result = await juno.setFollow(address, wallet, next);
      setFollowers(result.followers);
      setFollows(result.isFollowing);
    } catch (caught) {
      setFollows(before.follows);
      setFollowers(before.followers);
      setFollowError(caught instanceof Error ? caught.message : "That could not be saved");
    } finally {
      setSaving(false);
    }
  }, [me, follows, followers, saving, wallet]);

  const share = async () => {
    const outcome = await shareProfile(wallet, data?.name ?? null);
    if (outcome === "copied") setToast("Profile link copied");
    if (outcome === "failed") setToast("Could not share");
  };

  const handle = data?.name ? `@${data.name}` : shortAddress(wallet);
  // The coin a visitor is most likely to want: the biggest one still trading.
  const top = useMemo(() => [...created].sort((a, b) => b.marketCap - a.marketCap)[0] ?? null, [created]);
  const capCurrencies = new Set(created.map((coin) => coin.marketCapCurrency));
  const totalCap =
    data && data.missing === 0 && capCurrencies.size <= 1
      ? { value: created.reduce((sum, coin) => sum + coin.marketCap, 0), currency: [...capCurrencies][0] ?? "USD" }
      : null;

  const highlights = useMemo(() => {
    const out: Array<{ coin: Coin; kind: "reel" | "graduated" }> = [];
    for (const coin of created) {
      if (coin.curve.graduated) out.push({ coin, kind: "graduated" });
      else if (coin.format === "reel") out.push({ coin, kind: "reel" });
    }
    return out.slice(0, 10);
  }, [created]);

  const LABELS: Record<Tab, string> = { posts: "Posts", reels: "Reels", coins: "Coins", backed: "Backed", wallet: "Wallet" };
  const tabs = allowed.map((id) => ({ id, label: LABELS[id] }));

  return (
    <View style={styles.page}>
      <TopBar>
        {onBack ? (
          <RoundButton onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft />
          </RoundButton>
        ) : (
          <View style={{ width: 36 }} />
        )}
        <TopHandle numberOfLines={1}>{handle}</TopHandle>
        <RoundButton onPress={() => void share()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Share this profile">
          <ShareGlyph size={18} />
        </RoundButton>
      </TopBar>

      <ScrollView
        contentContainerStyle={{ paddingBottom: own ? 130 : 48 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={profile.refreshing}
            onRefresh={() => {
              profile.refresh();
              portfolio.refresh();
              board.refresh();
              onRefresh?.();
            }}
            tintColor={theme.colors.muted}
          />
        }
      >
        {profile.loading ? (
          <HeaderSkeleton />
        ) : profile.error || !data ? (
          <Placeholder
            title="This profile could not be loaded"
            detail={profile.error ?? "The server did not answer."}
            action={<Button label="Try again" onPress={profile.refresh} />}
          />
        ) : (
          <Header>
            <Row gap={18} align="center">
              <AvatarRing $creator={created.length > 0}>
                <Identicon seed={wallet} size={84} />
              </AvatarRing>
              <Row style={{ flex: 1 }}>
                <Stat value={String(posts.length)} label="Posts" />
                <Stat value={followers === null ? "—" : count(followers)} label={followers === 1 ? "Follower" : "Followers"} />
                <Stat value={count(data.following)} label="Following" />
              </Row>
            </Row>

            <Col gap={4} style={{ marginTop: 14 }}>
              <Row gap={8} style={{ flexWrap: "wrap" }}>
                <DisplayName numberOfLines={1}>{data.name ?? shortAddress(wallet)}</DisplayName>
                {created.length > 0 ? <Pill label="Creator" tone="lime" /> : null}
                {data.identity?.twitter ? <Pill label={`𝕏 @${data.identity.twitter}`} tone="ink" /> : null}
                {data.passkey ? (
                  <Pill label={data.passkey.where === "monad" ? "Passkey verified on Monad" : "Passkey verified (fork)"} tone="pos" />
                ) : null}
              </Row>
              {/* The address, under a name; without one the name line already is it. */}
              {data.name || (totalCap && created.length > 0) ? (
                <Mono muted style={{ fontSize: 12 }}>
                  {[data.name ? shortAddress(wallet) : null, totalCap && created.length > 0 ? `coins worth ${money(totalCap.value, totalCap.currency)}` : null]
                    .filter(Boolean)
                    .join("  ·  ")}
                </Mono>
              ) : null}
              {data.bio ? <Bio>{data.bio}</Bio> : own ? <Caption>No bio yet. Edit profile to add one.</Caption> : null}
              {data.link ? (
                <Pressable
                  onPress={() => void Linking.openURL(data.link!)}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${data.link}`}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start" }}
                >
                  <ExternalGlyph size={13} />
                  <LinkText numberOfLines={1}>{data.link.replace(/^https:\/\//, "").replace(/\/$/, "")}</LinkText>
                </Pressable>
              ) : null}
            </Col>

            <Row gap={8} style={{ marginTop: 16 }}>
              {own ? (
                <>
                  <Button label="Edit profile" variant="quiet" onPress={() => setEditing(true)} style={styles.action} />
                  <Button label="Share profile" variant="quiet" onPress={() => void share()} style={styles.action} />
                </>
              ) : (
                <>
                  <Button
                    label={follows === null ? "…" : follows ? "Following" : "Follow"}
                    variant={follows ? "quiet" : "lime"}
                    loading={saving}
                    disabled={follows === null}
                    onPress={() => void toggleFollow()}
                    style={styles.action}
                  />
                  {top ? (
                    <Button label={`Buy $${top.symbol}`} variant="ink" onPress={() => setBuying(top)} style={styles.action} />
                  ) : null}
                </>
              )}
            </Row>
            {followError ? <Body style={{ color: theme.colors.neg, marginTop: 8 }}>{followError}</Body> : null}
            {data.missing > 0 ? (
              <Caption style={{ marginTop: 8 }}>
                {data.missing} {data.missing === 1 ? "coin" : "coins"} could not be priced and {data.missing === 1 ? "is" : "are"} not shown. Pull to retry.
              </Caption>
            ) : null}
          </Header>
        )}

        {data && highlights.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlights}>
            {highlights.map(({ coin, kind }) => (
              <Highlight
                key={coin.address}
                coin={coin}
                kind={kind}
                onPress={() =>
                  kind === "reel" ? router.push(`/(tabs)/reels?start=${coin.address}` as never) : router.push(`/coin/${coin.address}`)
                }
              />
            ))}
          </ScrollView>
        ) : null}

        <TabBar role="tablist">
          {tabs.map((item) => (
            <TabItem
              key={item.id}
              onPress={() => setTab(item.id)}
              accessibilityRole="tab"
              aria-selected={item.id === tab}
              $on={item.id === tab}
            >
              <TabText $on={item.id === tab}>{item.label}</TabText>
            </TabItem>
          ))}
        </TabBar>

        {tab === "wallet" ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 14 }}>{walletTab}</View>
        ) : profile.loading ? (
          <GridSkeleton />
        ) : !data ? null : tab === "posts" ? (
          posts.length === 0 ? (
            <Empty
              title="No posts yet"
              detail={own ? "A photo or reel you post launches its own coin. People buy into it as they scroll." : "Nothing posted yet."}
              action={own ? <Button label="Post your first" onPress={() => router.push("/(tabs)/post" as never)} /> : undefined}
            />
          ) : (
            <Grid>
              {posts.map((coin) => (
                <CoinTile key={coin.address} coin={coin} shape="square" onPress={() => router.push(`/coin/${coin.address}`)} />
              ))}
            </Grid>
          )
        ) : tab === "reels" ? (
          reels.length === 0 ? (
            <Empty title="No reels yet" detail={own ? "A reel launches its own coin, the same way a post does." : "No reels posted yet."} />
          ) : (
            <Grid>
              {reels.map((coin) => (
                <CoinTile key={coin.address} coin={coin} shape="tall" onPress={() => router.push(`/coin/${coin.address}`)} />
              ))}
            </Grid>
          )
        ) : tab === "coins" ? (
          created.length === 0 ? (
            <Empty title="No coins launched" detail={own ? "Every post, reel or tracker you launch is listed here." : "This wallet has not launched a coin."} />
          ) : (
            <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 14 }}>
              {/* Your own coins open with what they have earned you. */}
              {own ? <Earnings wallet={wallet} coins={created} onClaimed={profile.refresh} /> : null}
              <Ledger>
                {created.map((coin, index) => (
                  <CoinRow key={coin.address} coin={coin} first={index === 0} onPress={() => router.push(`/coin/${coin.address}`)} />
                ))}
              </Ledger>
            </View>
          )
        ) : (
          <Backed
            wallet={wallet}
            own={own}
            portfolio={portfolio}
            board={board}
            createdSet={createdSet}
            onOpen={(token) => router.push(`/coin/${token}`)}
          />
        )}
      </ScrollView>

      {toast ? (
        <View style={[styles.toast, { pointerEvents: "none" }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {buying ? <QuickTrade coin={buying} side="buy" onClose={() => setBuying(null)} onDone={() => setBuying(null)} /> : null}

      {own && data ? (
        <EditProfileSheet
          visible={editing}
          wallet={wallet}
          profile={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            profile.refresh();
            setToast("Profile saved");
          }}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

/**
 * One launch as a tile: its picture, and its coin's change in the corner.
 *
 * The change is always there, because a phone has no hover. Holding the tile
 * (or hovering it in a browser) shows the price, market cap and holders over
 * the picture, the way a grid shows likes on hover elsewhere; a tap opens the
 * coin. The overlay is not revealed on press-in: text appearing under a
 * pointer mid-press reads to the browser as a selection, and React Native Web
 * then cancels the click. It also takes no pointer events and cannot be
 * selected, for the same reason.
 */
function CoinTile({ coin, shape, onPress }: { coin: Coin; shape: "square" | "tall"; onPress: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const still = juno.still(coin.media);
  const change = coin.marketCapChangePct;
  const up = change !== null && change >= 0;
  return (
    <Pressable
      testID="profile-tile"
      onPress={onPress}
      onLongPress={() => setRevealed(true)}
      onPressOut={() => setRevealed(false)}
      onHoverIn={() => setRevealed(true)}
      onHoverOut={() => setRevealed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${coin.name}, $${coin.symbol}`}
      style={[styles.tile, { aspectRatio: shape === "square" ? 1 : 2 / 3 }]}
    >
      <View style={styles.tileInner}>
        {/* The coin's mark, under the picture: it shows while an IPFS image is
            still on its way, and stays if the image never arrives. */}
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
          <CoinArt uri={null} seed={coin.address} size={72} radius={20} />
        </View>
        {still ? <Image source={{ uri: still }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {coin.format === "reel" ? (
          <View style={styles.tileBadge} testID="reel-badge" accessibilityLabel="Reel">
            <ReelBadgeGlyph size={14} />
          </View>
        ) : coin.curve.graduated ? (
          <View style={styles.tileVenue}>
            <Text style={styles.tileVenueText}>{coin.venue === "kuru" ? "Kuru" : "v2"}</Text>
          </View>
        ) : null}
        <View style={[styles.tileChange, { backgroundColor: change === null ? "rgba(18,21,14,0.72)" : up ? "rgba(14,159,110,0.92)" : "rgba(217,45,32,0.92)" }]}>
          <Text style={styles.tileChangeText}>
            {change === null ? "—" : `${up ? "▲" : "▼"} ${up ? "+" : "−"}${percent(change)}`}
          </Text>
        </View>
        {revealed ? (
          <View style={[styles.tileReveal, { pointerEvents: "none" }]}>
            <Text selectable={false} style={styles.tileSymbol}>${coin.symbol}</Text>
            <Text selectable={false} style={styles.tilePrice}>{money(coin.priceUsd, coin.marketCapCurrency, { compact: false })}</Text>
            <Text selectable={false} style={styles.tileMeta}>
              cap {money(coin.marketCap, coin.marketCapCurrency)}
              {coin.holders === null ? "" : ` · ${coin.holders} ${coin.holders === 1 ? "holder" : "holders"}`}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function CoinRow({ coin, first, onPress }: { coin: Coin; first: boolean; onPress: () => void }) {
  const where = coin.curve.graduated
    ? coin.venue === "kuru"
      ? "On Kuru"
      : "On Uniswap v2"
    : `Curve ${Math.round(coin.curve.progress * 100)}%`;
  const kind = coin.reference ? "Tracker" : coin.format === "reel" ? "Reel" : "Post";
  return (
    <Tappable onPress={onPress} to={0.985} accessibilityRole="button" accessibilityLabel={`Open ${coin.name}`}>
      <Entry $first={first}>
        <Row gap={12}>
          <CoinArt uri={juno.still(coin.media)} seed={coin.address} size={44} radius={14} />
          <Col gap={2} style={{ flex: 1 }}>
            <Label style={{ fontWeight: "700" }} numberOfLines={1}>
              {coin.name}
            </Label>
            <Caption numberOfLines={1}>
              ${coin.symbol} · {kind} · {where}
            </Caption>
          </Col>
          <Col gap={2} style={{ alignItems: "flex-end" }}>
            <Mono>{money(coin.marketCap, coin.marketCapCurrency)}</Mono>
            <Delta pct={coin.marketCapChangePct} />
          </Col>
          <Chevron />
        </Row>
      </Entry>
    </Tappable>
  );
}

/* ------------------------------------------------------------------ */
/* Backed                                                              */
/* ------------------------------------------------------------------ */

/**
 * What this wallet has put money into, beyond its own launches, and how that
 * has gone: their record from the leaderboard, other creators' coins they
 * hold as a grid, and the fills behind it.
 */
function Backed({
  wallet,
  own,
  portfolio,
  board,
  createdSet,
  onOpen,
}: {
  wallet: string;
  own: boolean;
  portfolio: ReturnType<typeof useApi<Awaited<ReturnType<typeof juno.portfolio>> | null>>;
  board: ReturnType<typeof useApi<Awaited<ReturnType<typeof juno.leaderboard>> | null>>;
  createdSet: Set<string>;
  onOpen: (token: string) => void;
}) {
  const row = board.data?.traders.find((entry) => sameAddress(entry.wallet, wallet)) ?? null;
  const rank = board.data?.traders.findIndex((entry) => sameAddress(entry.wallet, wallet)) ?? -1;
  const positions = portfolio.data?.positions ?? [];
  const backed = positions.filter((position) => !createdSet.has(position.token.toLowerCase()));

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 14 }}>
      {board.loading ? (
        <Card>
          <Skeleton h={14} w="40%" />
          <Skeleton h={28} w="60%" style={{ marginTop: 12 }} />
        </Card>
      ) : row ? (
        <Card>
          <Row justify="space-between" align="flex-start">
            <Col gap={2}>
              <Caption>Profit taken</Caption>
              <Taken $tone={row.realised > 0 ? "pos" : row.realised < 0 ? "neg" : "flat"}>
                {row.realised > 0 ? "+" : ""}
                {money(row.realised, "USD", { compact: false })}
              </Taken>
            </Col>
            {rank >= 0 ? <Pill label={`#${rank + 1} by profit taken`} /> : null}
          </Row>
          <Row style={{ marginTop: 14 }}>
            <Stat value={row.winRate === null ? "—" : `${Math.round(row.winRate * 100)}%`} label="Win rate" />
            <Stat value={row.unrealised === null ? "—" : money(row.unrealised, "USD")} label="Still open" />
            <Stat value={String(row.trades)} label="Fills" />
            <Stat value={String(row.coins)} label="Coins" />
          </Row>
        </Card>
      ) : board.error ? (
        <Card>
          <Body muted>Their record could not be read: {board.error}</Body>
        </Card>
      ) : board.data ? (
        <Card>
          <Body muted>
            {board.data.partial
              ? "Their record could not be read: the pool histories came back short."
              : own
                ? "No fills from your wallet on any Juno pool yet."
                : "No fills from this wallet on any Juno pool yet."}
          </Body>
        </Card>
      ) : null}

      {portfolio.loading ? (
        <GridSkeleton inset={false} />
      ) : portfolio.error ? (
        <Placeholder
          title="Could not read what they hold"
          detail={portfolio.error}
          action={<Button label="Try again" onPress={portfolio.refresh} />}
        />
      ) : backed.length === 0 ? (
        <Card>
          <Body muted>
            {portfolio.data?.partial
              ? "Some pools could not be read, so what this wallet backs is unknown."
              : own
                ? "You hold no other creator's coin yet. Buy into a post from the feed and it shows here."
                : "Backs no other creator's coin yet."}
          </Body>
        </Card>
      ) : (
        <>
          <Caption>
            {backed.length} {backed.length === 1 ? "coin" : "coins"} from other creators
            {portfolio.data?.partial ? ". Some pools would not load, so this may be short." : ""}
          </Caption>
          <View style={styles.gridFlush}>
            {backed.map((position) => (
              <PositionTile key={position.token} position={position} onPress={() => onOpen(position.token)} />
            ))}
          </View>
        </>
      )}

      {!portfolio.loading && !portfolio.error && positions.length > 0 ? (
        <>
          <Label style={{ fontWeight: "700", marginTop: 4 }}>Trades</Label>
          <TradeList positions={positions} />
        </>
      ) : null}
    </View>
  );
}

/**
 * A coin someone holds: its picture (or its drawn mark), and along the bottom
 * the coin, what the holding is worth and the P&L on its recorded cost.
 */
function PositionTile({ position, onPress }: { position: Position; onPress: () => void }) {
  const still = position.mediaUrl
    ? juno.still({
        kind: position.mediaMime?.startsWith("video") ? "video" : "image",
        url: position.mediaUrl,
        posterUrl: position.posterUrl ?? undefined,
      })
    : null;
  const pnl = position.unrealisedPnlPct;
  const up = pnl !== null && pnl >= 0;
  return (
    <Pressable
      testID="profile-backed-tile"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${position.name}: ${tokens(position.balance)} ${position.symbol}`}
      style={[styles.tile, { aspectRatio: 1 }]}
    >
      <View style={[styles.tileInner, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.tileMark}>
          <CoinArt uri={null} seed={position.token} size={52} radius={16} />
        </View>
        {still ? <Image source={{ uri: still }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={[styles.tileStrip, { pointerEvents: "none" }]}>
          <Text selectable={false} style={styles.tileStripSymbol} numberOfLines={1}>
            ${position.symbol} · {money(position.value, position.currency)}
          </Text>
          <Text
            selectable={false}
            style={[styles.tileStripPnl, { color: pnl === null ? theme.colors.onNightMuted : up ? "#7CF5C4" : "#FFB4AC" }]}
          >
            {pnl === null ? "no recorded cost" : `${up ? "+" : "−"}${percent(pnl)} on cost`}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Highlights                                                          */
/* ------------------------------------------------------------------ */

/**
 * The launches worth stopping on: reels (they play in Reels) and coins that
 * graduated into a Uniswap pair or a Kuru market. Drawn as story rings, the
 * reel ring in the feed's lime-to-pink, a graduation in solid lime.
 */
function Highlight({ coin, kind, onPress }: { coin: Coin; kind: "reel" | "graduated"; onPress: () => void }) {
  const still = juno.still(coin.media);
  const id = `hl${coin.address.slice(2, 10)}`;
  return (
    <Tappable
      onPress={onPress}
      to={0.92}
      accessibilityRole="button"
      accessibilityLabel={kind === "reel" ? `Play ${coin.name}` : `${coin.name}, graduated`}
    >
      <View style={styles.highlight}>
        <View style={styles.highlightRing}>
          <Svg width={68} height={68} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={id} x1="0" y1="1" x2="1" y2="0">
                <Stop offset="0" stopColor={theme.colors.lime} />
                <Stop offset="1" stopColor={kind === "reel" ? theme.colors.heart : theme.colors.limePress} />
              </LinearGradient>
            </Defs>
            <Circle cx={34} cy={34} r={32.5} stroke={`url(#${id})`} strokeWidth={3} fill="none" />
          </Svg>
          <View style={styles.highlightInner}>
            {still ? (
              <Image source={{ uri: still }} style={{ width: 58, height: 58 }} resizeMode="cover" />
            ) : (
              <CoinArt uri={null} seed={coin.address} size={58} radius={29} />
            )}
          </View>
        </View>
        <Text style={styles.highlightLabel} numberOfLines={1}>
          {kind === "graduated" ? (coin.venue === "kuru" ? "On Kuru" : "On v2") : `$${coin.symbol}`}
        </Text>
      </View>
    </Tappable>
  );
}

/* ------------------------------------------------------------------ */
/* Edit profile                                                        */
/* ------------------------------------------------------------------ */

const BIO_MAX = 150;

/** Mirrors `cleanLink` on the server: empty, or a plain https address with a host. */
function linkProblem(link: string): string | null {
  const value = link.trim();
  if (value === "") return null;
  if (value.length > 120) return "A link is at most 120 characters.";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "Links start with https://";
    if (!url.hostname.includes(".") || url.username || url.password) return "That link is not one people can open.";
    return null;
  } catch {
    return "Links start with https://";
  }
}

/**
 * Name, bio and link, each set by a signature from the wallet: free, no
 * transaction, and nobody else can change them. A name and a bio are separate
 * claims on the server, so changing both asks for two signatures (a device key
 * and a passkey session sign silently).
 */
function EditProfileSheet({
  visible,
  wallet,
  profile,
  onClose,
  onSaved,
}: {
  visible: boolean;
  wallet: string;
  profile: Profile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const signer = useWallet();
  const [name, setName] = useState(profile.name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [link, setLink] = useState(profile.link ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each opening starts from what is saved, not from an abandoned draft.
  useEffect(() => {
    if (!visible) return;
    setName(profile.name ?? "");
    setBio(profile.bio ?? "");
    setLink(profile.link ?? "");
    setError(null);
  }, [visible, profile.name, profile.bio, profile.link]);

  const cleanName = name.trim().toLowerCase();
  const nameChanged = cleanName !== (profile.name ?? "").toLowerCase() && cleanName !== "";
  const nameValid = cleanName === "" || /^[a-z0-9_]{3,20}$/.test(cleanName);
  const detailsChanged = bio.trim() !== (profile.bio ?? "") || link.trim() !== (profile.link ?? "");
  const bioLength = [...bio.trim()].length;
  const linkError = linkProblem(link);
  const valid = nameValid && bioLength <= BIO_MAX && linkError === null;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (nameChanged) {
        const issuedAt = new Date().toISOString();
        // Rebuilt character for character by `nameMessage` on the server.
        const signature = await signer.signMessage(`Juno name: ${cleanName}\nWallet: ${wallet}\nIssued: ${issuedAt}`);
        const result = await api.post<{ name: string }>("/api/juno/profiles", { wallet, name: cleanName, issuedAt, signature });
        rememberName(wallet, result.name);
      }
      if (detailsChanged) {
        const issuedAt = new Date().toISOString();
        const nextBio = bio.trim();
        const nextLink = link.trim();
        const signature = await signer.signMessage(detailsMessage(wallet, nextBio, nextLink, issuedAt));
        await juno.saveProfileDetails({ wallet, bio: nextBio, link: nextLink, issuedAt, signature });
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your profile could not be saved");
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} dismissable={!saving}>
      <View style={{ gap: 14, paddingHorizontal: 20, paddingTop: 4 }}>
        <SheetTitle>Edit profile</SheetTitle>

        <Col gap={6}>
          <FieldLabel>Name</FieldLabel>
          <View style={styles.field}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={name}
              onChangeText={(next) => setName(next.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20))}
              placeholder="yourname"
              placeholderTextColor={theme.colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Name"
              style={styles.input}
            />
          </View>
          {!nameValid ? <Caption style={{ color: theme.colors.neg }}>3–20 letters, digits or underscores.</Caption> : null}
        </Col>

        <Col gap={6}>
          <Row justify="space-between">
            <FieldLabel>Bio</FieldLabel>
            <Caption style={bioLength > BIO_MAX ? { color: theme.colors.neg } : undefined}>
              {bioLength}/{BIO_MAX}
            </Caption>
          </Row>
          <View style={[styles.field, { alignItems: "flex-start" }]}>
            <TextInput
              value={bio}
              onChangeText={setBio}
              placeholder="What you post, in a line or two"
              placeholderTextColor={theme.colors.faint}
              multiline
              numberOfLines={3}
              accessibilityLabel="Bio"
              style={[styles.input, { minHeight: 66, textAlignVertical: "top" }]}
            />
          </View>
        </Col>

        <Col gap={6}>
          <FieldLabel>Link</FieldLabel>
          <View style={styles.field}>
            <TextInput
              value={link}
              onChangeText={setLink}
              placeholder="https://"
              placeholderTextColor={theme.colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Link"
              style={styles.input}
            />
          </View>
          {linkError ? <Caption style={{ color: theme.colors.neg }}>{linkError}</Caption> : null}
        </Col>

        <Caption style={error ? { color: theme.colors.neg } : undefined}>
          {error ?? "Your wallet signs each change. Free, no transaction."}
        </Caption>

        <Row gap={8}>
          <Button label="Cancel" variant="quiet" onPress={onClose} disabled={saving} style={{ flex: 1 }} />
          <Button
            label="Save"
            onPress={() => void save()}
            loading={saving}
            disabled={!valid || (!nameChanged && !detailsChanged)}
            style={{ flex: 1 }}
          />
        </Row>
      </View>
    </BottomSheet>
  );
}

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

function HeaderSkeleton() {
  return (
    <Header>
      <Row gap={18}>
        <Skeleton h={88} w={88} round={44} />
        <Row gap={16} style={{ flex: 1, justifyContent: "space-around" }}>
          {[0, 1, 2].map((i) => (
            <Col key={i} gap={6} style={{ alignItems: "center" }}>
              <Skeleton h={18} w={34} />
              <Skeleton h={10} w={52} />
            </Col>
          ))}
        </Row>
      </Row>
      <Skeleton h={18} w="45%" style={{ marginTop: 16 }} />
      <Skeleton h={12} w="70%" style={{ marginTop: 8 }} />
      <Row gap={8} style={{ marginTop: 16 }}>
        <Skeleton h={44} w="48%" round={22} />
        <Skeleton h={44} w="48%" round={22} />
      </Row>
    </Header>
  );
}

function GridSkeleton({ inset = true }: { inset?: boolean }) {
  return (
    <View style={inset ? styles.grid : styles.gridFlush}>
      {Array.from({ length: 6 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: six fixed placeholders, never reordered
        <View key={i} style={[styles.tile, { aspectRatio: 1 }]}>
          <View style={[styles.tileInner, { backgroundColor: theme.colors.line }]} />
        </View>
      ))}
    </View>
  );
}

function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyMark}>
        <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
          <Path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke={theme.colors.muted} strokeWidth={1.6} strokeLinejoin="round" />
        </Svg>
      </View>
      <EmptyTitle>{title}</EmptyTitle>
      <EmptyDetail>{detail}</EmptyDetail>
      {action ? <View style={{ marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}

const EmptyTitle = styled.Text`
  font-size: ${(p) => p.theme.type.lead.size}px;
  font-weight: 800;
  color: ${(p) => p.theme.colors.text};
  text-align: center;
`;

const EmptyDetail = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  line-height: 20px;
  color: ${(p) => p.theme.colors.muted};
  text-align: center;
  max-width: 300px;
`;

/** A change as a share, unsigned: 0.034 → "3.4%", 49.42 → "4,942%". */
function percent(change: number): string {
  const value = Math.abs(change * 100);
  if (value >= 100) return `${Math.round(value).toLocaleString("en-US")}%`;
  return `${value.toFixed(1)}%`;
}

/** 1234 → 1.2k, the way a follower count reads. */
function count(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  if (value >= 1_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const TopBar = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space(2)}px;
  padding-horizontal: ${(p) => p.theme.space(4)}px;
  padding-vertical: ${(p) => p.theme.space(2)}px;
`;

const TopHandle = styled.Text`
  flex: 1;
  text-align: center;
  font-size: ${(p) => p.theme.type.lead.size}px;
  font-weight: 800;
  color: ${(p) => p.theme.colors.text};
`;

const RoundButton = styled.Pressable`
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background-color: ${(p) => p.theme.colors.surface};
  align-items: center;
  justify-content: center;
`;

const Header = styled.View`
  padding-horizontal: ${(p) => p.theme.space(4)}px;
  padding-top: ${(p) => p.theme.space(2)}px;
  padding-bottom: ${(p) => p.theme.space(4)}px;
`;

const AvatarRing = styled.View<{ $creator: boolean }>`
  width: 94px;
  height: 94px;
  border-radius: 47px;
  align-items: center;
  justify-content: center;
  border-width: 3px;
  border-color: ${(p) => (p.$creator ? p.theme.colors.lime : p.theme.colors.surface)};
  background-color: ${(p) => p.theme.colors.surface};
`;

const DisplayName = styled.Text`
  font-size: ${(p) => p.theme.type.title.size}px;
  line-height: ${(p) => p.theme.type.title.height}px;
  font-weight: 800;
  letter-spacing: ${(p) => p.theme.type.title.tracking}px;
  color: ${(p) => p.theme.colors.text};
  flex-shrink: 1;
`;

const Bio = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  line-height: 20px;
  color: ${(p) => p.theme.colors.text};
  margin-top: 4px;
`;

const LinkText = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 700;
  color: ${(p) => p.theme.colors.focus};
`;

const TabBar = styled.View`
  flex-direction: row;
  border-bottom-width: 1px;
  border-bottom-color: ${(p) => p.theme.colors.lineStrong};
  background-color: ${(p) => p.theme.colors.bg};
`;

const TabItem = styled.Pressable<{ $on: boolean }>`
  flex: 1;
  align-items: center;
  padding-vertical: ${(p) => p.theme.space(3)}px;
  border-bottom-width: 2px;
  border-bottom-color: ${(p) => (p.$on ? p.theme.colors.text : "transparent")};
  margin-bottom: -1px;
`;

const TabText = styled.Text<{ $on: boolean }>`
  font-size: ${(p) => p.theme.type.caption.size + 1}px;
  font-weight: ${(p) => (p.$on ? 800 : 600)};
  color: ${(p) => (p.$on ? p.theme.colors.text : p.theme.colors.faint)};
`;

const Grid = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  padding: 1px;
`;

const Taken = styled.Text<{ $tone: "pos" | "neg" | "flat" }>`
  font-size: ${(p) => p.theme.type.heading.size}px;
  line-height: ${(p) => p.theme.type.heading.height}px;
  font-weight: 700;
  font-variant: tabular-nums;
  color: ${(p) => (p.$tone === "pos" ? p.theme.colors.pos : p.$tone === "neg" ? p.theme.colors.neg : p.theme.colors.text)};
`;

const SheetTitle = styled.Text`
  font-size: ${(p) => p.theme.type.title.size}px;
  font-weight: 800;
  color: ${(p) => p.theme.colors.text};
`;

const FieldLabel = styled.Text`
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: ${(p) => p.theme.colors.muted};
`;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.bg },
  action: { flex: 1, height: 44, paddingHorizontal: 12 },
  highlights: { gap: 14, paddingHorizontal: 16, paddingBottom: 14 },
  highlight: { alignItems: "center", gap: 6, width: 72 },
  highlightRing: { width: 68, height: 68, alignItems: "center", justifyContent: "center" },
  highlightInner: { width: 58, height: 58, borderRadius: 29, overflow: "hidden", backgroundColor: theme.colors.ink },
  highlightLabel: { fontSize: 12, fontWeight: "700", color: theme.colors.text },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: 1 },
  gridFlush: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -1 },
  tile: { width: "33.3333%", padding: 1 },
  tileInner: { flex: 1, overflow: "hidden", backgroundColor: theme.colors.surfaceAlt },
  tileBadge: { position: "absolute", top: 8, right: 8 },
  tileVenue: {
    position: "absolute",
    top: 6,
    right: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: theme.colors.lime,
  },
  tileVenueText: { fontSize: 10, fontWeight: "800", color: theme.colors.onLime },
  tileChange: { position: "absolute", left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  tileChangeText: { fontSize: 11, fontWeight: "800", color: "#FFFFFF", fontVariant: ["tabular-nums"] },
  tileReveal: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(7,8,10,0.62)",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    padding: 6,
  },
  tileMark: { position: "absolute", top: 0, left: 0, right: 0, bottom: 34, alignItems: "center", justifyContent: "center" },
  tileStrip: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "rgba(7,8,10,0.66)",
  },
  tileStripSymbol: { fontSize: 11, fontWeight: "800", color: theme.colors.onNight, fontVariant: ["tabular-nums"] },
  tileStripPnl: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
  tileSymbol: { fontSize: 12, fontWeight: "800", color: theme.colors.onNightMuted },
  tilePrice: { fontSize: 15, fontWeight: "800", color: theme.colors.onNight, fontVariant: ["tabular-nums"] },
  tileMeta: { fontSize: 11, fontWeight: "600", color: theme.colors.onNightMuted, textAlign: "center" },
  empty: { alignItems: "center", gap: 6, paddingTop: 40, paddingHorizontal: 24, paddingBottom: 24 },
  emptyMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: theme.colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  toast: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    backgroundColor: theme.colors.ink,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  toastText: { color: theme.colors.onInk, fontWeight: "700", fontSize: 13 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  at: { fontSize: 16, fontWeight: "800", color: theme.colors.muted, marginRight: 2 },
  input: { flex: 1, fontSize: 16, fontWeight: "600", color: theme.colors.text, padding: 0 },
});
