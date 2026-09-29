import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Linking, RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Rect } from "react-native-svg";
import styled from "styled-components/native";

import { CoinGlyph, Identicon } from "../../components/art";
import { CommentsSheet } from "../../components/CommentsSheet";
import { DepthChart } from "../../components/DepthChart";
import { Handle } from "../../components/Handle";
import { PriceLine } from "../../components/PriceLine";
import { Tappable } from "../../components/Press";
import {
  AlertSheet,
  PlanSheet,
  SaveCard,
  WatchToggle,
  type SavedState,
} from "../../components/Save";
import { KuruOrdersCard } from "../../components/KuruOrders";
import { TradeSheet } from "../../components/TradeSheet";
import {
  Body,
  Button,
  Caption,
  Card,
  ChevronLeft,
  Col,
  ExternalGlyph,
  Label,
  Mono,
  Pill,
  Placeholder,
  Row,
  Skeleton,
  Stat,
  Title,
} from "../../components/kit";
import { useRetryingUri } from "../../lib/retry-image";
import { sameAddress, toAddress } from "../../lib/address";
import {
  juno,
  MON_ADDRESS,
  networkLabel,
  type Network,
  type NavReference,
  type Plan,
  type UnsignedTransaction,
} from "../../lib/api";
import { bookPrice, money, since, sum, tokens, useApi } from "../../lib/useApi";
import { shareCoin } from "../../lib/social";
import { useWallet } from "../../lib/wallet";
import { theme } from "../../theme";

/**
 * One coin: what it is, what it costs, and how to trade it.
 *
 * ## Why the chart is the whole top of the screen
 *
 * Every other arrangement of this page buried the price in a card among other
 * cards, which is a claim that the price is one fact of several. It is not —
 * it is the reason anyone opened the screen. So it is edge to edge, with no
 * container around it, and everything else is arranged underneath in the order
 * the questions actually get asked: *what is this*, *how big is it*, *who else
 * is here*, *what are the details*.
 *
 * ## Why the rest is tabbed rather than stacked
 *
 * Activity, holders, comments and metadata are four answers to four different
 * questions, and only one is wanted at a time. Stacked, they made the page
 * thousands of points long and pushed the buy button off the bottom of it;
 * tabbed, the action bar is always in reach and the page never changes height
 * when a slow read lands.
 *
 * ## The NAV band and the savings card
 *
 * Both live under **Details**, because that is what they are: facts about this
 * instrument rather than about its market. The watch toggle stays in the nav
 * bar, where it is one tap from anywhere on the page.
 *
 * ## A curve's three lives
 *
 * Trading on the curve, full and waiting, and graduated. A full curve takes no
 * trades until someone sends the graduation transaction that moves its
 * reserves into the Uniswap v2 pair — and anyone may, so the Buy button
 * becomes Graduate rather than disappearing. The creator also gets a Claim
 * for the fees their coin has earned; nobody else sees it.
 */

const TABS = [
  { id: "activity" as const, label: "Activity" },
  { id: "holders" as const, label: "Holders" },
  { id: "comments" as const, label: "Comments" },
  { id: "details" as const, label: "Details" },
];

type Tab = (typeof TABS)[number]["id"];

export default function CoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const address = toAddress(token);
  // A path that is not an address names no coin. Said at once, rather than
  // after four requests the server can only answer with 400s.
  if (!address) {
    return (
      <Page edges={["top"]}>
        <Nav>
          <Back onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <ChevronLeft />
          </Back>
        </Nav>
        <NoSuchCoin onBack={() => router.replace("/(tabs)/social" as never)} />
      </Page>
    );
  }
  return <CoinDetail token={address} />;
}

function NoSuchCoin({ onBack }: { onBack: () => void }) {
  return (
    <Placeholder
      title="No such coin"
      detail="Nothing on Juno has this address. It may be on another network, or the link is wrong."
      action={<Button label="Back to the feed" onPress={onBack} />}
    />
  );
}

function CoinDetail({ token }: { token: string }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<"buy" | "sell" | null>(null);
  const [savingsSheet, setSavingsSheet] = useState<"alert" | "plan" | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("activity");
  const [copied, setCopied] = useState(false);
  /**
   * The plan this buy is a contribution to, if any.
   *
   * Held while the trade sheet is open so the fill can be recorded against the
   * right row — and cleared when the sheet closes, so an ordinary buy made
   * straight afterwards is not silently counted towards a savings goal.
   */
  const [contributing, setContributing] = useState<Omit<Plan, "coin"> | null>(null);

  const wallet = useWallet();
  const detail = useApi(() => juno.coin(token), [token]);
  const coin = detail.data?.coin;
  /** The creator chose Kuru: the curve graduates into its own Kuru market, and trades there after. */
  const onKuru = coin?.venue === "kuru";
  // A coin that graduated into Uniswap v2 trades in the app through Juno's
  // router, when the deployment has one; otherwise it links to its pair.
  const pairTrading = !!coin?.curve.graduated && !onKuru && juno.loadedConfig()?.v2Trading === true;

  // Only for the count on the tab — the sheet reads its own list when opened,
  // because a list fetched on mount is stale by the time anyone looks at it.
  const comments = useApi(() => juno.comments(token), [token]);

  /*
   * What this wallet holds of this coin, for the sell side.
   *
   * It was read out of the whole-portfolio walk, which reads every pool's
   * history and is routinely cut short on the public RPC — so right after a
   * buy the sell tab said "Balance: —" and every percentage was disabled. One
   * token-balance read is exact and fast, and it is re-read after each trade.
   */
  const [tradeRevision, setTradeRevision] = useState(0);
  const held = useApi(
    async () => (wallet.address ? juno.balance(wallet.address, token) : null),
    [wallet.address, token, tradeRevision],
  );
  const holding = held.data?.balance ?? null;

  /* What a buy would spend from. Read separately because it is the quote side,
     which the portfolio does not cover: it accounts for coins held, not for the
     MON that buys them. */
  const quoteToken = coin?.quote.address ?? null;
  const quoteNative = coin?.quote.native ?? true;
  const spendable = useApi(
    async () => (wallet.address && quoteToken ? juno.balance(wallet.address, quoteToken) : null),
    [wallet.address, quoteToken, tradeRevision],
  );
  // MON for gas, when the market is priced in something else.
  const feeMon = useApi(
    async () =>
      wallet.address && quoteToken && !quoteNative ? juno.balance(wallet.address, MON_ADDRESS) : null,
    [wallet.address, quoteToken, quoteNative, tradeRevision],
  );

  /* The two actions that are not trades. Both refresh the coin when they land,
     because each one changes what the screen should say: fees drop to zero,
     or the curve becomes a pair. */
  const isCreator = !!coin && sameAddress(wallet.address, coin.creator.wallet);
  const claim = useSignedAction(
    (address) => juno.claim({ creator: address, token }),
    () => detail.refresh(),
  );
  const graduate = useSignedAction(
    (address) => juno.graduate({ from: address, token }),
    () => {
      setTradeRevision((n) => n + 1);
      detail.refresh();
    },
  );

  /*
   * Watching, alerts and plans for this wallet on this coin.
   *
   * Postgres only — no chain reads — because this decides what a button says
   * and the list endpoints that answer the same questions each hydrate every
   * pool to do it. Held in local state as well as fetched, so a toggle shows
   * immediately instead of after a round trip.
   */
  const savedRead = useApi(
    async () => (wallet.address ? juno.saved(wallet.address, token) : null),
    [wallet.address, token],
  );
  const [savedLocal, setSavedLocal] = useState<SavedState | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  useEffect(() => {
    if (!savedRead.data) return;
    setSavedLocal({
      watching: savedRead.data.watching,
      alertPrice: savedRead.data.alertPrice,
      alertSetAtPrice: savedRead.data.alertSetAtPrice,
      plans: savedRead.data.plans,
    });
  }, [savedRead.data]);

  // "Copied" is a state that has to expire on its own: nothing else on the
  // screen changes to clear it.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const art = coin ? juno.still(coin.media) : null;
  const heroImage = useRetryingUri(art);
  const ticks = useMemo(
    () => (coin?.priceHistory ?? []).map((point) => ({ t: point.t, price: point.price })),
    [coin?.priceHistory],
  );
  const commentCount = comments.data?.comments.length ?? null;

  return (
    <Page edges={["top"]}>
      <Nav>
        <Back onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft />
        </Back>
        <NavGrow />
        {/* Nothing to watch until there is a coin. */}
        {coin ? (
          <WatchToggle saved={savedLocal} wallet={wallet.address} token={token} onChange={setSavedLocal} />
        ) : null}
      </Nav>

      {detail.loading ? (
        /* Shaped like the screen it precedes — a chart, an identity row, a
           stats band — rather than one big block over an empty screen. A coin
           read can take fifteen seconds against the public endpoint, which is
           a long time to look at nothing. */
        <Loading>
          <Skeleton h={40} w="52%" />
          <Skeleton h={210} round={18} style={{ marginTop: 18 }} />
          <Row gap={12} style={{ marginTop: 22 }}>
            <Skeleton h={34} w={34} round={17} />
            <Skeleton h={14} w="40%" />
          </Row>
          <Skeleton h={26} w="80%" style={{ marginTop: 14 }} />
          <Skeleton h={64} round={16} style={{ marginTop: 18 }} />
        </Loading>
      ) : detail.errorStatus === 404 || detail.errorStatus === 400 ? (
        // Not a failure to retry: there is no such coin on this network.
        <NoSuchCoin onBack={() => router.replace("/(tabs)/social" as never)} />
      ) : detail.error || !coin ? (
        <Placeholder
          title="Could not load this coin"
          detail={detail.error ?? undefined}
          action={<Button label="Try again" onPress={detail.refresh} />}
        />
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ width: "100%", paddingBottom: 150 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={detail.refreshing}
                onRefresh={() => {
                  detail.refresh();
                  comments.refresh();
                }}
                tintColor={theme.colors.muted}
              />
            }
          >
            {/* The post itself, first, when there is one. A market that is
                a photo or a reel was shown as a price chart with the picture
                nowhere on the page — the thing people are buying into, missing
                from the screen where they buy it. Trackers have no media and
                open on their chart. */}
            {art && !coin.nav && coin.reference == null ? (
              <Padded>
                <Tappable
                  onPress={() =>
                    coin.media.kind === "video"
                      ? router.push(`/(tabs)/reels?start=${coin.address}` as never)
                      : undefined
                  }
                  to={coin.media.kind === "video" ? 0.98 : 1}
                  accessibilityRole={coin.media.kind === "video" ? "button" : "image"}
                  accessibilityLabel={coin.media.kind === "video" ? `Play ${coin.name}` : coin.name}
                >
                  <Hero
                    source={{ uri: heroImage.uri ?? art }}
                    onError={heroImage.onError}
                    resizeMode="cover"
                    style={{
                      aspectRatio:
                        coin.media.width && coin.media.height
                          ? Math.max(0.8, Math.min(1.25, coin.media.width / coin.media.height))
                          : 1,
                    }}
                  />
                  {coin.media.kind === "video" ? (
                    <PlayOver style={{ pointerEvents: "none" }}>
                      <PlayDisc>
                        <Svg width={26} height={26} viewBox="0 0 24 24">
                          <Path d="M7 4.5v15l12.5-7.5z" fill="#FFFFFF" />
                        </Svg>
                      </PlayDisc>
                    </PlayOver>
                  ) : null}
                </Tappable>
              </Padded>
            ) : null}

            <PriceLine
              ticks={ticks}
              livePrice={coin.priceUsd}
              partial={coin.priceHistoryPartial === true}
              format={(value) => price(value, coin.marketCapCurrency)}
            />

            <Padded>
              {/* Who made it, how many hold it, and a way to pass it on. */}
              <Row gap={10} align="center">
                <Tappable
                  onPress={() => router.push(`/trader/${coin.creator.wallet}` as never)}
                  to={0.95}
                >
                  <Row gap={8} align="center">
                    {art ? <Thumb source={{ uri: art }} /> : <CoinGlyph size={30} seed={coin.address} />}
                    <Label style={{ fontWeight: "700" }} numberOfLines={1}>
                      <Handle wallet={coin.creator.wallet} />
                    </Label>
                  </Row>
                </Tappable>
                <NavGrow />
                <Caption numberOfLines={1}>
                  {/* When the holder count could not be read, the decoded
                      trades answer instead: wallets whose fills still net
                      positive, counted from a complete read only — a partial
                      one would undercount. */}
                  {(() => {
                    const crowd = detail.data?.crowd;
                    const n =
                      coin.holders ?? (crowd && !crowd.partial ? crowd.holdersStill : null);
                    return n === null ? "— holders" : `${n} ${n === 1 ? "holder" : "holders"}`;
                  })()}
                </Caption>
                <Tappable
                  onPress={async () => {
                    const outcome = await shareCoin(coin);
                    // "Copied" on the chip below is the one confirmation this
                    // screen already has; a copied link reuses it.
                    if (outcome === "copied") setCopied(true);
                  }}
                  to={0.86}
                >
                  <IconTap hitSlop={8} accessibilityRole="button" accessibilityLabel="Share">
                    <ShareGlyph />
                  </IconTap>
                </Tappable>
              </Row>

              <Title style={{ marginTop: 12 }}>{coin.name}</Title>
              {coin.description ? (
                <Body muted style={{ marginTop: 6 }}>
                  {coin.description}
                </Body>
              ) : null}

              <Row gap={8} style={{ marginTop: 12 }}>
                <Chip>
                  <ChipMark>$</ChipMark>
                  <ChipText numberOfLines={1}>{coin.symbol}</ChipText>
                </Chip>
                <Tappable
                  onPress={async () => {
                    await Clipboard.setStringAsync(coin.address);
                    setCopied(true);
                  }}
                  to={0.95}
                >
                  <Chip accessibilityRole="button" accessibilityLabel="Copy the coin address">
                    <CopyGlyph />
                    <ChipText>{copied ? "Copied" : "Copy address"}</ChipText>
                  </Chip>
                </Tappable>
              </Row>

              {/* Three figures, ruled apart rather than boxed — the band is one
                  reading of size, not three separate cards. */}
              <Band>
                <Cell>
                  <CellValue>{money(coin.marketCap, coin.marketCapCurrency)}</CellValue>
                  <Caption numberOfLines={1}>Market cap</Caption>
                </Cell>
                <Divider />
                <Cell>
                  <CellValue>
                    {coin.totalVolume === null ? "—" : money(coin.totalVolume, coin.marketCapCurrency)}
                  </CellValue>
                  <Caption numberOfLines={1}>Total volume</Caption>
                </Cell>
                <Divider />
                <Cell>
                  <CellValue>
                    {money(coin.creatorRewards, coin.marketCapCurrency, { compact: false })}
                  </CellValue>
                  <Caption numberOfLines={1}>Creator rewards</Caption>
                </Cell>
              </Band>

              {isCreator ? (
                <FeesCard
                  // Just claimed and still re-reading: the amount on screen is the
                  // one that was paid out, so it must not sit beside "Claimed".
                  claimable={claim.hash && (detail.refreshing || detail.loading) ? 0 : coin.creatorRewards}
                  currency={coin.marketCapCurrency}
                  busy={claim.busy}
                  error={claim.error}
                  hash={claim.hash}
                  onClaim={() => void claim.run()}
                />
              ) : null}

              {/* Raised against threshold, with both ends labelled. A bar with
                  no numbers on it is a mood. */}
              {coin.curve.graduated ? (
                <Col gap={6} style={{ marginTop: 16 }}>
                  <Row gap={8}>
                    <Pill label={onKuru ? "On Kuru" : "Graduated"} tone="pos" />
                    <Caption style={{ flex: 1 }}>
                      {onKuru
                        ? "Trades on its own Kuru market now: an order book, plus a vault holding the curve's reserves for good."
                        : pairTrading
                          ? "Trades on its Uniswap v2 pair now, right here: buys and sells go through Juno's router. The liquidity is locked for good."
                          : "Trades on its Uniswap v2 pair now. The liquidity is locked for good."}
                    </Caption>
                  </Row>
                  {onKuru && coin.kuru ? (
                    <Caption>
                      Bid {bookPrice(coin.kuru.bestBid, coin.quote.symbol)} · Ask{" "}
                      {bookPrice(coin.kuru.bestAsk, coin.quote.symbol)}
                      {coin.kuru.spread !== null ? ` · spread ${(coin.kuru.spread * 100).toFixed(2)}%` : ""}
                    </Caption>
                  ) : null}
                  {coin.pair && juno.explorable() ? (
                    <LinkTap onPress={() => Linking.openURL(juno.explorer("address", coin.pair!))}>
                      <LinkText>{onKuru ? "View the Kuru market on MonadVision" : "View the pair on MonadVision"}</LinkText>
                      <ExternalGlyph />
                    </LinkTap>
                  ) : null}
                  {graduate.hash && juno.explorable() ? (
                    <LinkTap onPress={() => Linking.openURL(juno.explorer("tx", graduate.hash!))}>
                      <LinkText>The transaction that graduated it</LinkText>
                      <ExternalGlyph />
                    </LinkTap>
                  ) : null}
                  {onKuru ? <KuruOrdersCard coin={coin} onChanged={() => detail.refresh()} /> : null}
                </Col>
              ) : coin.curve.complete ? (
                <Col gap={6} style={{ marginTop: 16 }}>
                  <Row gap={8}>
                    <Pill label="Curve full" tone="lime" />
                    <Caption style={{ flex: 1 }}>
                      {onKuru
                        ? "Trading pauses until someone opens its Kuru market. Anyone can."
                        : "Trading pauses until someone moves it into its Uniswap v2 pair. Anyone can."}
                    </Caption>
                  </Row>
                  {graduate.error ? <ErrorLine>{graduate.error}</ErrorLine> : null}
                </Col>
              ) : (
                <RaisedRow>
                  <End>{sum(coin.curve.raisedUsd, coin.marketCapCurrency)}</End>
                  <Track>
                    {/* A floor of 1.5% so a curve 0.02% of the way along still
                        reads as started — but only above zero, where drawing
                        anything would claim a raise nobody made. */}
                    {coin.curve.progress > 0 ? (
                      <FillBar
                        style={{
                          width: `${Math.min(100, Math.max(1.5, coin.curve.progress * 100))}%`,
                        }}
                      />
                    ) : null}
                  </Track>
                  <End>{sum(coin.curve.thresholdUsd, coin.marketCapCurrency)}</End>
                </RaisedRow>
              )}

              <TabBar>
                {TABS.map((option) => (
                  <TabTap
                    key={option.id}
                    onPress={() =>
                      option.id === "comments" ? setCommentsOpen(true) : setTab(option.id)
                    }
                    accessibilityRole="button"
                    aria-selected={tab === option.id}
                  >
                    <TabLabel $on={tab === option.id}>
                      {option.label}
                      {option.id === "comments" && commentCount !== null && commentCount > 0
                        ? ` ${commentCount}`
                        : ""}
                    </TabLabel>
                    <TabRule $on={tab === option.id} />
                  </TabTap>
                ))}
              </TabBar>

              {tab === "activity" ? (
                <ActivityTab
                  rows={detail.data!.activity}
                  partial={detail.data!.activityPartial}
                  currency={coin.marketCapCurrency}
                  onOpenTrader={(target) => router.push(`/trader/${target}` as never)}
                />
              ) : tab === "holders" ? (
                <HoldersTab
                  rows={detail.data!.holders}
                  unreadable={detail.data!.holdersUnreadable}
                  source={detail.data!.holdersSource}
                  indexer={detail.data!.indexer}
                  onOpenTrader={(target) => router.push(`/trader/${target}` as never)}
                />
              ) : (
                <DetailsTab
                  coin={coin}
                  network={detail.data!.network}
                  launchTx={detail.data!.launchTx}
                  saveCard={
                    <SaveCard
                      coin={coin}
                      saved={savedLocal}
                      wallet={wallet.address}
                      error={savedError}
                      onEditAlert={() => setSavingsSheet("alert")}
                      onNewPlan={() => setSavingsSheet("plan")}
                      onContribute={(plan) => {
                        setContributing(plan);
                        setSheet("buy");
                      }}
                      onTogglePlan={(plan) => void togglePlan(plan)}
                      onRemovePlan={(plan) => void removePlan(plan)}
                    />
                  }
                />
              )}
            </Padded>
          </ScrollView>

          {/* Say something, or take a position. The two things this screen is
              for, always within reach of a thumb. */}
          <Actions>
            {/* The glyph alone. The word beside it was the one label on a bar
                whose other half says Buy, and it read as a second primary
                action competing with the one that matters. */}
            <Tappable onPress={() => setCommentsOpen(true)} to={0.94}>
              <PostTap accessibilityRole="button" accessibilityLabel="Comment on this coin">
                <PostGlyph />
              </PostTap>
            </Tappable>
            {coin.curve.graduated && !onKuru && !pairTrading ? (
              <GraduatedNote>Trades on its Uniswap v2 pair.</GraduatedNote>
            ) : coin.curve.complete && !coin.curve.graduated ? (
              <Button
                label={graduate.busy ? "Graduating…" : onKuru ? "Open on Kuru" : "Graduate"}
                variant="ink"
                tall
                loading={graduate.busy}
                onPress={() => void graduate.run()}
                style={{ flex: 1 }}
              />
            ) : (
              <Button
                label="Buy"
                variant="lime"
                tall
                onPress={() => setSheet("buy")}
                style={{ flex: 1 }}
              />
            )}
          </Actions>

          {sheet ? (
            <TradeSheet
              coin={coin}
              side={sheet}
              holding={holding}
              quoteBalance={spendable.data?.balance ?? null}
              feeBalance={quoteNative ? null : (feeMon.data?.balance ?? null)}
              initialAmount={sheet === "buy" && contributing ? String(contributing.amount) : ""}
              onFilled={(spent, txHash) => void recordFill(spent, txHash)}
              onCommented={() => comments.refresh()}
              onClose={() => {
                setSheet(null);
                setContributing(null);
              }}
              onDone={() => {
                setSheet(null);
                setContributing(null);
                setTradeRevision((n) => n + 1);
                detail.refresh();
              }}
            />
          ) : null}

          <CommentsSheet
            visible={commentsOpen}
            onClose={() => setCommentsOpen(false)}
            target={{ kind: "coin", token, symbol: coin.symbol }}
            onPosted={() => comments.refresh()}
          />

          <AlertSheet
            visible={savingsSheet === "alert"}
            onClose={() => setSavingsSheet(null)}
            coin={coin}
            wallet={wallet.address}
            saved={savedLocal}
            onSaved={setSavedLocal}
          />
          <PlanSheet
            visible={savingsSheet === "plan"}
            onClose={() => setSavingsSheet(null)}
            coin={coin}
            wallet={wallet.address}
            saved={savedLocal}
            onSaved={setSavedLocal}
          />
        </>
      )}
    </Page>
  );

  /** Pause or resume, optimistically, rolling back if the write is refused. */
  async function togglePlan(plan: Omit<Plan, "coin">) {
    if (!savedLocal) return;
    const next = !plan.active;
    setSavedError(null);
    setSavedLocal({
      ...savedLocal,
      plans: savedLocal.plans.map((row) =>
        row.id === plan.id ? { ...row, active: next, due: next && row.due } : row,
      ),
    });
    try {
      await juno.setPlanActive(plan.id, next);
    } catch (caught) {
      setSavedLocal(savedLocal);
      setSavedError(caught instanceof Error ? caught.message : "That could not be saved");
    }
  }

  /** Remove a paused plan, optimistically, putting it back if the write is refused. */
  async function removePlan(plan: Omit<Plan, "coin">) {
    if (!savedLocal) return;
    setSavedError(null);
    setSavedLocal({ ...savedLocal, plans: savedLocal.plans.filter((row) => row.id !== plan.id) });
    try {
      await juno.removePlan(plan.id);
    } catch (caught) {
      setSavedLocal(savedLocal);
      setSavedError(caught instanceof Error ? caught.message : "That could not be removed");
    }
  }

  /**
   * A buy confirmed on chain; if it was a contribution, write it down.
   *
   * Not optimistic, and deliberately so. Everything else on this card can be
   * rolled back on a failed write; a contribution total is the one figure that
   * is supposed to mean *this actually happened*, so it moves only once the
   * server has agreed, and the row it returns is what replaces the local one.
   */
  async function recordFill(spent: number, txHash: string) {
    const plan = contributing;
    if (!plan || spent <= 0) return;
    setSavedError(null);
    try {
      const { plan: fresh } = await juno.recordContribution(plan.id, spent, txHash);
      setSavedLocal((current) =>
        current === null
          ? current
          : {
              ...current,
              plans: current.plans.map((row) => (row.id === fresh.id ? { ...row, ...fresh } : row)),
            },
      );
    } catch (caught) {
      // The swap landed either way — this only failed to be *recorded*, and
      // saying so is better than a progress bar that quietly did not move.
      setSavedError(
        caught instanceof Error
          ? `The buy went through, but it was not recorded against your plan: ${caught.message}`
          : "The buy went through, but it was not recorded against your plan.",
      );
    }
  }
}


/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function ActivityTab({
  rows,
  partial,
  currency,
  onOpenTrader,
}: {
  rows: import("../../lib/api").Activity[];
  partial: boolean;
  currency: string;
  onOpenTrader: (wallet: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <Empty>
        {/* An empty list that was never successfully read is not an empty
            market. Saying "No trades yet" there is a claim the app did not
            earn. */}
        <Body muted>
          {partial
            ? "Trade history could not be read — the RPC is rate-limiting."
            : "No trades yet."}
        </Body>
      </Empty>
    );
  }

  return (
    <>
      {rows.slice(0, 20).map((row) => (
        <Line key={row.id}>
          <Tappable onPress={() => onOpenTrader(row.wallet)} to={0.97}>
            <Row gap={8} align="center">
              <Identicon seed={row.wallet} size={26} />
              <Label numberOfLines={1} style={{ maxWidth: 96 }}>
                <Handle wallet={row.wallet} />
              </Label>
            </Row>
          </Tappable>
          <Verb $buy={row.side === "buy"}>{row.side === "buy" ? "Buy" : "Sell"}</Verb>
          <Mono style={{ flex: 1, textAlign: "right" }}>{tokens(row.amount)}</Mono>
          <Mono muted style={{ width: 66, textAlign: "right" }}>
            {money(row.valueUsd, currency)}
          </Mono>
          <Caption style={{ width: 34, textAlign: "right" }}>{since(row.timestamp)}</Caption>
        </Line>
      ))}
      {partial ? (
        <Caption style={{ marginTop: 12 }}>
          Some of this pool&rsquo;s history would not load — these are the fills that did.
        </Caption>
      ) : null}
    </>
  );
}

function HoldersTab({
  rows,
  unreadable,
  source,
  indexer,
  onOpenTrader,
}: {
  rows: import("../../lib/api").Holder[];
  unreadable: boolean;
  /** How the server built the list — the caption says so, because each misses different wallets. */
  source: string | null;
  /** How current the indexer is, when the list came from it. */
  indexer?: { progressBlock: number; behind: number } | null;
  onOpenTrader: (wallet: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <Empty>
        <Body muted>
          {unreadable
            ? "The holder list could not be read from the chain — which is not the same as nobody holding this."
            : "Nobody holds this yet."}
        </Body>
      </Empty>
    );
  }

  return (
    <>
      {rows.map((row) => (
        <Line key={row.wallet}>
          <Rank>{row.rank}</Rank>
          <Tappable onPress={() => onOpenTrader(row.wallet)} to={0.97}>
            <Row gap={8} align="center">
              <Identicon seed={row.wallet} size={26} />
              <Label numberOfLines={1} style={{ maxWidth: 96 }}>
                <Handle wallet={row.wallet} />
              </Label>
            </Row>
          </Tappable>
          <Mono style={{ flex: 1, textAlign: "right" }}>{tokens(row.balance)}</Mono>
          <Mono muted style={{ width: 56, textAlign: "right" }}>
            {(row.share * 100).toFixed(1)}%
          </Mono>
        </Line>
      ))}
      <Caption style={{ marginTop: 12 }}>
        {source === "indexer"
          ? `Every holder, from the Envio indexer's record of every transfer of this token${
              indexer
                ? indexer.behind <= 2
                  ? `, current to block ${indexer.progressBlock.toLocaleString()}.`
                  : `, ${indexer.behind.toLocaleString()} blocks behind the chain.`
                : "."
            }`
          : source === "fills"
            ? "Rebuilt from trades — the live balance read was refused, and transfers are not visible this way."
            : "Live balances of every wallet that has traded this coin. A wallet that only received it by transfer is not listed."}
      </Caption>
    </>
  );
}

function DetailsTab({
  coin,
  network,
  launchTx,
  saveCard,
}: {
  coin: import("../../lib/api").Coin;
  network: Network;
  launchTx: string | null;
  saveCard: React.ReactNode;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(key: string, value: string) {
    await Clipboard.setStringAsync(value);
    setCopied(key);
  }

  return (
    <Col gap={0}>
      {saveCard ? <SaveSlot>{saveCard}</SaveSlot> : null}

      {coin.nav ? <NavBand nav={coin.nav} /> : null}

      {/* How a buy of each size moves the price — the preset, measured. Only
          while there is a curve left to quote. */}
      {coin.curve.graduated || coin.curve.complete ? null : <DepthChart token={coin.address} />}

      <Rows>
        <DetailRow
          label="Created"
          value={new Date(coin.createdAt).toLocaleString()}
          shaded={false}
        />
        <DetailRow
          label="Token address"
          value={short(coin.address)}
          shaded
          copied={copied === "token"}
          onCopy={() => void copy("token", coin.address)}
        />
        <DetailRow label="Ticker" value={coin.symbol} shaded={false} copied={copied === "ticker"} onCopy={() => void copy("ticker", coin.symbol)} />
        <DetailRow label="Network" value={networkLabel(network)} shaded />
        <DetailRow label="Quote" value={coin.quote.symbol} shaded={false} />
        <DetailRow label="Curve" value={coin.curvePreset} shaded />
        <DetailRow label="Format" value={coin.format === "reel" ? "Reel" : "Post"} shaded={false} />
        {/* The pair exists from launch — locked until graduation — so it is
            a fact about this coin from its first block, not only its last.
            A Kuru market does not exist until graduation, but its CREATE2
            address is fixed at launch, so it is shown with when it opens. */}
        <DetailRow
          label={coin.venue === "kuru" ? "Kuru market" : "Uniswap v2 pair"}
          value={
            coin.pair
              ? coin.venue === "kuru" && !coin.curve.graduated
                ? `${short(coin.pair)} · opens at graduation`
                : short(coin.pair)
              : coin.venue === "kuru"
                ? "Opens at graduation"
                : "—"
          }
          shaded
          copied={copied === "pair"}
          onCopy={coin.pair ? () => void copy("pair", coin.pair!) : undefined}
        />
        <DetailRow
          label="Launchpad"
          value={short(coin.launchpad)}
          shaded={false}
          copied={copied === "launchpad"}
          onCopy={() => void copy("launchpad", coin.launchpad)}
        />
      </Rows>

      {juno.explorable() ? (
        <LinkTap onPress={() => Linking.openURL(juno.explorer("token", coin.address))}>
          <LinkText>View the token on MonadVision</LinkText>
          <ExternalGlyph />
        </LinkTap>
      ) : null}
      {launchTx && juno.explorable() ? (
        <LinkTap onPress={() => Linking.openURL(juno.explorer("tx", launchTx))}>
          <LinkText>The transaction that launched it</LinkText>
          <ExternalGlyph />
        </LinkTap>
      ) : null}
    </Col>
  );
}

/**
 * The creator's fees, and the one button that pays them out.
 *
 * Only the creator sees it — the server refuses anyone else's claim, and a
 * button that can only fail is not an affordance. The figure is what the pool
 * holds for them *now*, so a coin that was just claimed says there is nothing
 * to claim rather than repeating a total already sitting in their wallet.
 */
function FeesCard({
  claimable,
  currency,
  busy,
  error,
  hash,
  onClaim,
}: {
  claimable: number;
  currency: string;
  busy: boolean;
  error: string | null;
  hash: string | null;
  onClaim: () => void;
}) {
  const empty = !(claimable > 0);
  return (
    <Card style={{ marginTop: 14 }}>
      <Row gap={12} align="center">
        <Col gap={3} style={{ flex: 1 }}>
          <Label style={{ fontWeight: "700" }}>Your trading fees</Label>
          <Caption>
            {empty
              ? "Nothing to claim yet. Fees build up as people trade."
              : `${money(claimable, currency, { compact: false })} ready to claim`}
          </Caption>
        </Col>
        <Button label="Claim" variant="ink" loading={busy} disabled={empty} onPress={onClaim} />
      </Row>
      {error ? <ErrorLine style={{ marginTop: 10 }}>{error}</ErrorLine> : null}
      {hash ? (
        juno.explorable() ? (
          <LinkTap onPress={() => Linking.openURL(juno.explorer("tx", hash))}>
            <LinkText>Claimed — view the transaction</LinkText>
            <ExternalGlyph />
          </LinkTap>
        ) : (
          <Caption style={{ marginTop: 10 }}>Claimed — tx {hash.slice(0, 8)}…{hash.slice(-6)}</Caption>
        )
      ) : null}
    </Card>
  );
}

/**
 * Build, sign, submit — for the actions on this screen that are not trades.
 *
 * A trade gets a sheet because it has a quote to weigh. Claiming and
 * graduating have nothing to decide beyond pressing, so they get a button, a
 * busy state, the reason when it fails, and the hash when it lands.
 */
function useSignedAction(
  build: (address: string) => Promise<{ steps: UnsignedTransaction[] }>,
  onLanded: () => void,
) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setHash(null);
    try {
      const address = wallet.address ?? (await wallet.connect());
      const { steps } = await build(address);
      const landed = await wallet.signAndSubmit(steps);
      setHash(landed[landed.length - 1]?.hash ?? null);
      onLanded();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not go through");
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, hash, run };
}

/** `0x1234…abcd` — enough to recognise, with the full address one tap away. */
function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function DetailRow({
  label,
  value,
  shaded,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  shaded: boolean;
  onCopy?: () => void;
  copied?: boolean;
}) {
  const body = (
    <DetailBox $shaded={shaded}>
      <Label muted>{label}</Label>
      <Row gap={6} align="center">
        <DetailValue numberOfLines={1}>{copied ? "Copied" : value}</DetailValue>
        {onCopy ? <CopyGlyph /> : null}
      </Row>
    </DetailBox>
  );
  return onCopy ? (
    <Tappable onPress={onCopy} to={0.985} accessibilityRole="button" accessibilityLabel={`Copy ${label}`}>
      {body}
    </Tappable>
  ) : (
    body
  );
}

/**
 * Where the curve sits against the underlying.
 *
 * Three states, kept distinct because conflating them is the whole problem. An
 * equity feed outside exchange hours shows Friday's close — normal, and labelled
 * as such rather than dressed up as live.
 */
function NavBand({ nav }: { nav: NavReference }) {
  const label =
    nav.tessera?.id ??
    /^Equity\.[A-Z]+\.([A-Z.]+)\/USD$/.exec(nav.feed)?.[1] ??
    nav.feed.slice(0, 8);
  const state =
    nav.state === "live"
      ? "Live"
      : nav.state === "closed"
        ? "Market closed · last close"
        : nav.state === "mark"
          ? "Published mark"
          : "Stale";

  /*
   * Three states, not two.
   *
   * A curve token costs a hundredth of a cent and a share costs hundreds of
   * dollars, so the two are only comparable once the token's price is restated
   * in the reference's units. A pool with no ratio recorded has no deviation —
   * which is different from being outside the band, and used to render as
   * "-100.00%, outside" on every tracker in the app.
   */
  const measured = nav.deviation !== null && nav.withinBand !== null;

  return (
    <Card style={{ marginTop: 14 }}>
      <Row justify="space-between">
        <Label style={{ fontWeight: "700" }}>{label} reference</Label>
        <Caption
          style={{
            color:
              nav.state === "live"
                ? theme.colors.pos
                : nav.state === "stale"
                  ? theme.colors.neg
                  : theme.colors.muted,
          }}
        >
          {state}
        </Caption>
      </Row>

      <Row justify="space-between" align="baseline" style={{ marginTop: 8 }}>
        <CellValue style={{ fontSize: theme.type.heading.size }}>
          {money(nav.priceUsd, "USD", { compact: false })}
        </CellValue>
        <Mono
          style={{
            color: !measured
              ? theme.colors.muted
              : nav.withinBand
                ? theme.colors.pos
                : theme.colors.neg,
          }}
        >
          {measured ? `${nav.deviation! >= 0 ? "+" : ""}${(nav.deviation! * 100).toFixed(2)}%` : "—"}
        </Mono>
      </Row>

      <Caption style={{ marginTop: 8 }}>
        {!measured
          ? `This market names ${label} as its reference but never recorded how much of it one token stands for, so the two prices cannot be compared.`
          : `This curve implies ${money(nav.impliedUsd!, "USD", { compact: false })} against a ${money(
              nav.priceUsd,
              "USD",
              { compact: false },
            )} mark — ${nav.withinBand ? "inside" : "outside"} this preset's ${
              nav.bandBps / 100
            }% band. ${
              nav.source === "tessera"
                ? "Tessera publishes no timestamp with it, so freshness is unknown."
                : "Read from Pyth on-chain."
            }`}
      </Caption>

      {/* What Tessera carries and an oracle does not: a company behind the
          mark. Juno marks against Tessera's published price and never holds
          the T-token itself, which lives on another chain. */}
      {nav.tessera ? (
        <>
          <Split />
          <Row>
            <Stat value={String(nav.tessera.holders)} label="T-token holders" />
            <Stat
              value={money(nav.tessera.markValuation, "USD")}
              label="Implied valuation"
            />
            <Stat value={nav.tessera.sector} label="Sector" />
          </Row>
        </>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Glyphs                                                              */
/* ------------------------------------------------------------------ */

function ShareGlyph() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 15V3.8M12 3.8 8.3 7.5M12 3.8l3.7 3.7"
        stroke={theme.colors.text}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.5 12.6v5.9a1.6 1.6 0 0 0 1.6 1.6h9.8a1.6 1.6 0 0 0 1.6-1.6v-5.9"
        stroke={theme.colors.text}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function CopyGlyph() {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
      <Rect x={8.6} y={8.6} width={11.4} height={11.4} rx={2.6} stroke={theme.colors.muted} strokeWidth={1.9} />
      <Path
        d="M15.4 5.6a2 2 0 0 0-2-1.6H6.6A2.6 2.6 0 0 0 4 6.6v6.8a2 2 0 0 0 1.6 2"
        stroke={theme.colors.muted}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function PostGlyph() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 12.4c0 3.9-3.6 7-8 7a9 9 0 0 1-2.4-.3L5 21l1.2-3.3A6.6 6.6 0 0 1 4 12.4c0-3.9 3.6-7 8-7s8 3.1 8 7z"
        stroke={theme.colors.text}
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Prices on a bonding curve start far below a cent, so a two-decimal format
 * would render most of this app's markets as "$0.00". Three significant
 * figures keeps the reading true at any magnitude.
 */
function price(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "—";
  // `money` already writes sub-cent prices the way traders do — 0.0₆242 —
  // where `toPrecision` printed "$2.42e-7" in the largest type on the screen.
  return money(value, currency, { compact: false });
}

const Page = styled(SafeAreaView)`
  flex: 1;
  background-color: ${(p) => p.theme.colors.bg};
`;

const Nav = styled.View`
  flex-direction: row;
  align-items: center;
  padding-horizontal: ${(p) => p.theme.space(4)}px;
  padding-bottom: ${(p) => p.theme.space(2)}px;
`;

const NavGrow = styled.View`
  flex: 1;
`;

const Back = styled.Pressable`
  width: 36px;
  height: 36px;
  border-radius: 18px;
  background-color: ${(p) => p.theme.colors.surface};
  align-items: center;
  justify-content: center;
`;

const Loading = styled.View`
  padding-horizontal: ${(p) => p.theme.space(4)}px;
`;

const Padded = styled.View`
  padding-horizontal: ${(p) => p.theme.space(4)}px;
  padding-top: ${(p) => p.theme.space(5)}px;
`;

const Hero = styled.Image`
  width: 100%;
  border-radius: ${(p) => p.theme.radius.lg}px;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
  margin-bottom: ${(p) => p.theme.space(3)}px;
`;

const PlayOver = styled.View`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: ${(p) => p.theme.space(3)}px;
  align-items: center;
  justify-content: center;
`;

const PlayDisc = styled.View`
  width: 64px;
  height: 64px;
  border-radius: 32px;
  padding-left: 4px;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.45);
  border-width: 1.5px;
  border-color: rgba(255, 255, 255, 0.7);
`;

const Thumb = styled.Image`
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;

const IconTap = styled.View`
  padding: 4px;
`;

const Chip = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  border-radius: ${(p) => p.theme.radius.pill}px;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;

const ChipMark = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 800;
  color: ${(p) => p.theme.colors.muted};
`;

const ChipText = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 700;
  letter-spacing: ${(p) => p.theme.type.label.tracking}px;
  color: ${(p) => p.theme.colors.text};
`;

const Band = styled.View`
  flex-direction: row;
  align-items: stretch;
  margin-top: ${(p) => p.theme.space(5)}px;
  padding-vertical: ${(p) => p.theme.space(3)}px;
  border-top-width: ${(p) => p.theme.hairline}px;
  border-bottom-width: ${(p) => p.theme.hairline}px;
  border-color: ${(p) => p.theme.colors.line};
`;

const Cell = styled.View`
  flex: 1;
  gap: 3px;
  padding-horizontal: 4px;
`;

const CellValue = styled.Text`
  font-size: ${(p) => p.theme.type.lead.size}px;
  font-weight: 800;
  font-variant: tabular-nums;
  letter-spacing: ${(p) => p.theme.type.lead.tracking}px;
  color: ${(p) => p.theme.colors.text};
`;

/** A hairline inside a card, where the sheet's own rules do not reach. */
const Split = styled.View`
  height: ${(p) => p.theme.hairline}px;
  background-color: ${(p) => p.theme.colors.line};
  margin-vertical: ${(p) => p.theme.space(4)}px;
`;

const Divider = styled.View`
  width: ${(p) => p.theme.hairline}px;
  background-color: ${(p) => p.theme.colors.line};
`;

const RaisedRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-top: ${(p) => p.theme.space(4)}px;
`;

const End = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  font-weight: 700;
  font-variant: tabular-nums;
  color: ${(p) => p.theme.colors.muted};
`;

const Track = styled.View`
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background-color: ${(p) => p.theme.colors.line};
  overflow: hidden;
`;

const FillBar = styled.View`
  height: 8px;
  background-color: ${(p) => p.theme.colors.pos};
`;

const TabBar = styled.View`
  flex-direction: row;
  gap: ${(p) => p.theme.space(5)}px;
  margin-top: ${(p) => p.theme.space(5)}px;
  border-bottom-width: ${(p) => p.theme.hairline}px;
  border-bottom-color: ${(p) => p.theme.colors.line};
`;

const TabTap = styled.Pressable`
  padding-bottom: 10px;
`;

const TabLabel = styled.Text<{ $on: boolean }>`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: ${(p) => (p.$on ? 800 : 600)};
  letter-spacing: ${(p) => p.theme.type.label.tracking}px;
  color: ${(p) => (p.$on ? p.theme.colors.text : p.theme.colors.muted)};
`;

const TabRule = styled.View<{ $on: boolean }>`
  height: 2px;
  margin-top: 8px;
  margin-bottom: -1px;
  background-color: ${(p) => (p.$on ? p.theme.colors.text : "transparent")};
`;

const Line = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding-vertical: ${(p) => p.theme.space(3)}px;
  border-bottom-width: ${(p) => p.theme.hairline}px;
  border-bottom-color: ${(p) => p.theme.colors.line};
`;

const Verb = styled.Text<{ $buy: boolean }>`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 800;
  width: 38px;
  color: ${(p) => (p.$buy ? p.theme.colors.pos : p.theme.colors.neg)};
`;

const Rank = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  font-weight: 700;
  font-variant: tabular-nums;
  width: 18px;
  color: ${(p) => p.theme.colors.faint};
`;

const Empty = styled.View`
  padding-vertical: ${(p) => p.theme.space(6)}px;
`;

const SaveSlot = styled.View`
  margin-top: ${(p) => p.theme.space(4)}px;
`;

const Rows = styled.View`
  margin-top: ${(p) => p.theme.space(4)}px;
  border-radius: ${(p) => p.theme.radius.md}px;
  overflow: hidden;
`;

const DetailBox = styled.View<{ $shaded: boolean }>`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px ${(p) => p.theme.space(3)}px;
  background-color: ${(p) => (p.$shaded ? p.theme.colors.surfaceAlt : "transparent")};
`;

const DetailValue = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 700;
  font-variant: tabular-nums;
  color: ${(p) => p.theme.colors.text};
`;

const LinkTap = styled.Pressable`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  margin-top: ${(p) => p.theme.space(4)}px;
`;

const LinkText = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 700;
  color: ${(p) => p.theme.colors.focus};
`;

const Actions = styled.View`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  flex-direction: row;
  gap: ${(p) => p.theme.space(3)}px;
  padding-horizontal: ${(p) => p.theme.space(4)}px;
  padding-top: ${(p) => p.theme.space(3)}px;
  /* Clear of the home indicator. */
  padding-bottom: ${(p) => p.theme.space(7)}px;
  background-color: ${(p) => p.theme.colors.bg};
  border-top-width: ${(p) => p.theme.hairline}px;
  border-top-color: ${(p) => p.theme.colors.line};
`;

const PostTap = styled.View`
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  border-radius: ${(p) => p.theme.radius.pill}px;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;

const ErrorLine = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  line-height: 18px;
  color: ${(p) => p.theme.colors.neg};
`;

const GraduatedNote = styled.Text`
  flex: 1.4;
  font-size: ${(p) => p.theme.type.label.size}px;
  color: ${(p) => p.theme.colors.muted};
  text-align: center;
  align-self: center;
`;
