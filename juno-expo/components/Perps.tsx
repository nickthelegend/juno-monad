import { useEffect, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { BottomSheet } from "./BottomSheet";
import { Button, Caption, Label, Mono, Pill, Segmented, Skeleton } from "./kit";
import { juno, type PerpAccount, type PerpMarket, type PerpPosition } from "../lib/api";
import { money, useApi } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * Perps, through Perpl: BTC, ETH, SOL, MON and the rest, isolated margin in
 * AUSD, on Monad's on-chain perps exchange.
 *
 * Market data is Perpl's own, live. The account, its collateral and every
 * position are read from Perpl's contract. Orders are Juno's usual
 * server-built transactions — immediate-or-cancel with a worst price 1% from
 * the mark — signed by the same wallet as everything else.
 */
export function PerpsPanel() {
  const wallet = useWallet();
  const markets = useApi(() => juno.perps(), []);
  const account = useApi(
    () => (wallet.address ? juno.perpAccount(wallet.address) : Promise.resolve(null)),
    [wallet.address],
  );
  const [trading, setTrading] = useState<PerpMarket | null>(null);
  const [depositing, setDepositing] = useState(false);

  const refresh = () => {
    markets.refresh();
    account.refresh();
  };

  return (
    <ScrollView
      contentContainerStyle={{ width: "100%", paddingHorizontal: 16, paddingBottom: 130, gap: 12 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={markets.refreshing} onRefresh={refresh} tintColor={theme.colors.muted} />
      }
    >
      <Caption style={{ paddingHorizontal: 4 }}>
        Perpetuals on Perpl, Monad&apos;s on-chain perps exchange. Isolated margin, collateral in AUSD, prices live
        from Perpl.
      </Caption>

      {wallet.address ? (
        <AccountCard
          account={account.data ?? null}
          loading={account.loading}
          onDeposit={() => setDepositing(true)}
          onChanged={refresh}
        />
      ) : null}

      {markets.loading ? (
        [0, 1, 2].map((i) => <Skeleton key={i} h={64} round={theme.radius.lg} />)
      ) : markets.error ? (
        <Caption>Perpl&apos;s market data did not answer. Pull to retry.</Caption>
      ) : (
        (markets.data?.markets ?? []).map((market) => (
          <MarketRow key={market.id} market={market} onPress={() => setTrading(market)} />
        ))
      )}

      <OpenSheet
        market={trading}
        account={account.data ?? null}
        onClose={() => setTrading(null)}
        onDone={() => {
          setTrading(null);
          refresh();
        }}
      />
      <DepositSheet
        visible={depositing}
        account={account.data ?? null}
        onClose={() => setDepositing(false)}
        onDone={() => {
          setDepositing(false);
          account.refresh();
        }}
      />
    </ScrollView>
  );
}

function pct(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function MarketRow({ market, onPress }: { market: PerpMarket; onPress: () => void }) {
  const up = (market.change24h ?? 0) >= 0;
  return (
    <Pressable onPress={onPress} role="button" style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Label style={{ fontWeight: "800" }}>
          {market.symbol}-PERP <Text style={styles.muted}>· up to {market.maxLeverage}x</Text>
        </Label>
        <Caption>
          OI {money(market.openInterestUsd, "USD")} · funding {pct(market.fundingRate, 4)} ·{" "}
          vol {money(market.volume24hUsd, "USD")}
        </Caption>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Mono style={{ fontWeight: "700" }}>{money(market.mark, "USD", { compact: false })}</Mono>
        <Text style={{ color: up ? theme.colors.pos : theme.colors.neg, fontWeight: "700", fontSize: 13 }}>
          {pct(market.change24h)}
        </Text>
      </View>
    </Pressable>
  );
}

function AccountCard({
  account,
  loading,
  onDeposit,
  onChanged,
}: {
  account: PerpAccount | null;
  loading: boolean;
  onDeposit: () => void;
  onChanged: () => void;
}) {
  const wallet = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading && !account) return <Skeleton h={96} round={theme.radius.lg} />;
  if (!account) return null;

  const run = async (key: string, build: () => Promise<{ steps: Parameters<typeof wallet.signAndSubmit>[0] }>) => {
    setBusy(key);
    setError(null);
    try {
      const { steps } = await build();
      const results = await wallet.signAndSubmit(steps);
      const perp = results[results.length - 1]?.perp;
      if (perp?.unfilledLots && perp.unfilledLots === perp.totalLots) {
        setError("Nothing filled inside 1.5% of the mark. The position is unchanged.");
      }
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not go through");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.between}>
        <View style={{ gap: 2 }}>
          <Caption>On Perpl</Caption>
          <Label style={{ fontWeight: "800", fontSize: 20 }}>{money(account.balance, "USD", { compact: false })}</Label>
          <Caption>
            AUSD free{account.locked > 0 ? ` · ${money(account.locked, "USD")} in orders` : ""} ·{" "}
            {money(account.walletAusd, "USD")} in your wallet
          </Caption>
        </View>
        <View style={{ gap: 6 }}>
          <Button label={account.accountId ? "Deposit" : "Open account"} variant="ink" onPress={onDeposit} />
          {account.balance > 0 ? (
            <Button
              label={busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
              variant="quiet"
              loading={busy === "withdraw"}
              onPress={() => void run("withdraw", () => juno.perpWithdraw({ owner: wallet.address!, amount: account.balance }))}
            />
          ) : null}
        </View>
      </View>

      {account.accountId === null && account.walletAusd === 0 ? (
        <Caption>
          Perpl takes AUSD as collateral, {account.minimumOpen} to open an account. On testnet it comes from Agora&apos;s
          faucet contract; if it is dry, Perpl&apos;s Discord can help.
        </Caption>
      ) : null}

      {account.positions.map((position) => (
        <PositionRow
          key={position.perpId}
          position={position}
          busy={busy === String(position.perpId)}
          onClose={() =>
            void run(String(position.perpId), () => juno.perpClose({ owner: wallet.address!, perpId: position.perpId }))
          }
        />
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function PositionRow({ position, busy, onClose }: { position: PerpPosition; busy: boolean; onClose: () => void }) {
  const up = position.pnl >= 0;
  return (
    <View style={[styles.between, styles.position]}>
      <View style={{ gap: 2, flex: 1 }}>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Pill label={position.side === "long" ? "Long" : "Short"} tone={position.side === "long" ? "pos" : "neg"} />
          <Label style={{ fontWeight: "700" }}>
            {position.size} {position.symbol}
          </Label>
        </View>
        <Caption>
          Entry {money(position.entryPrice, "USD", { compact: false })} · mark {money(position.markPrice, "USD", { compact: false })}
          {position.liquidationPrice ? ` · liq ${money(position.liquidationPrice, "USD", { compact: false })}` : ""}
        </Caption>
        <Text style={{ color: up ? theme.colors.pos : theme.colors.neg, fontWeight: "700" }}>
          {up ? "+" : ""}
          {money(position.pnl, "USD", { compact: false })} on {money(position.collateral, "USD")}
        </Text>
        {!position.markValid ? <Caption>Perpl&apos;s price is stale: closing works, adding does not.</Caption> : null}
      </View>
      <Button label={busy ? "Closing…" : "Close"} variant="quiet" loading={busy} onPress={onClose} />
    </View>
  );
}

const SIDES = [
  { id: "long" as const, label: "Long" },
  { id: "short" as const, label: "Short" },
];

function OpenSheet({
  market,
  account,
  onClose,
  onDone,
}: {
  market: PerpMarket | null;
  account: PerpAccount | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const wallet = useWallet();
  const [side, setSide] = useState<"long" | "short">("long");
  const [collateral, setCollateral] = useState("");
  const [leverage, setLeverage] = useState(2);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!market) return;
    setCollateral("");
    setLeverage(Math.min(2, market.maxLeverage));
    setStatus(null);
    setError(null);
    setDone(null);
  }, [market]);

  if (!market) return <BottomSheet visible={false} onClose={onClose}>{null}</BottomSheet>;

  const amount = Number(collateral || "0");
  // The server's sizing: room for the taker fee and a fill up to 1% from the mark.
  const size = amount > 0 ? (amount * leverage) / (1 + 0.01 + leverage * market.takerFee) / market.mark : 0;
  const options = [1, 2, 3, 5, 10, 15].filter((x) => x <= market.maxLeverage);
  const funded = account?.accountId !== null && (account?.balance ?? 0) > 0;

  const open = async () => {
    if (!wallet.address || !(amount > 0)) return;
    setBusy(true);
    setError(null);
    try {
      const built = await juno.perpOpen({ owner: wallet.address, perpId: market.id, side, collateral: amount, leverage });
      setStatus(`Opening ${built.size} ${market.symbol}…`);
      const results = await wallet.signAndSubmit(built.steps);
      const last = results[results.length - 1];
      if (last.perp?.opened) {
        setDone(last.hash);
        setStatus(`${leverage}x ${side} on ${market.symbol} open: ${built.size} at about ${money(built.mark, "USD", { compact: false })}.`);
      } else {
        setStatus(null);
        setError("Nothing filled inside 1% of the mark, so no position was opened. Try again.");
      }
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : "The order did not go through");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible onClose={done ? onDone : onClose} dismissable={!busy}>
      <View style={styles.sheet}>
        <Label style={{ fontWeight: "800", fontSize: 18 }}>
          {market.symbol}-PERP · {money(market.mark, "USD", { compact: false })}
        </Label>
        <Segmented items={SIDES} value={side} onChange={setSide} />
        <Caption>Collateral, AUSD {account ? `(free on Perpl: ${money(account.balance, "USD", { compact: false })})` : ""}</Caption>
        <TextInput
          value={collateral}
          onChangeText={setCollateral}
          placeholder="25"
          placeholderTextColor={theme.colors.faint}
          inputMode="decimal"
          style={styles.input}
        />
        <Caption>Leverage</Caption>
        <View style={styles.chips}>
          {options.map((option) => (
            <Pressable
              key={option}
              onPress={() => setLeverage(option)}
              role="radio"
              aria-checked={leverage === option}
              style={[styles.chip, leverage === option && styles.chipOn]}
            >
              <Text style={[styles.chipText, leverage === option && styles.chipTextOn]}>{option}x</Text>
            </Pressable>
          ))}
        </View>
        <Caption>
          {amount > 0
            ? `About ${size.toPrecision(3)} ${market.symbol} (${money(size * market.mark, "USD")} notional), filled now within 1% of the mark. Taker fee ${(market.takerFee * 100).toFixed(3)}%.`
            : `Funding ${pct(market.fundingRate, 4)} per ${Math.round(market.fundingIntervalSec / 60)} min; positive means longs pay shorts.`}
        </Caption>
        {done ? (
          <>
            <Text style={styles.ok}>{status}</Text>
            <Button label="View the transaction" variant="quiet" onPress={() => Linking.openURL(juno.explorer("tx", done))} />
            <Button label="Done" variant="lime" tall onPress={onDone} />
          </>
        ) : funded ? (
          <Button
            label={busy ? (status ?? "Opening…") : `Open ${leverage}x ${side}`}
            variant={side === "long" ? "buy" : "sell"}
            tall
            loading={busy}
            disabled={!(amount > 0)}
            onPress={() => void open()}
          />
        ) : (
          <Caption>Deposit AUSD on Perpl first — the account card above.</Caption>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

function DepositSheet({
  visible,
  account,
  onClose,
  onDone,
}: {
  visible: boolean;
  account: PerpAccount | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const wallet = useWallet();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAmount(account && account.accountId === null ? String(account.minimumOpen) : "");
    setStatus(null);
    setError(null);
  }, [visible, account]);

  const deposit = async () => {
    const value = Number(amount || "0");
    if (!wallet.address || !(value > 0)) return;
    setBusy(true);
    setError(null);
    try {
      const { steps } = await juno.perpDeposit({ owner: wallet.address, amount: value });
      await wallet.signAndSubmit(steps, (step) =>
        setStatus(step.total > 1 ? `${step.label}… (${step.index + 1}/${step.total})` : `${step.label}…`),
      );
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The deposit did not go through");
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} dismissable={!busy}>
      <View style={styles.sheet}>
        <Label style={{ fontWeight: "800", fontSize: 18 }}>
          {account?.accountId ? "Deposit AUSD" : "Open your Perpl account"}
        </Label>
        <Caption>
          {account?.accountId
            ? "Adds free collateral. Positions draw on it when they open."
            : `A Perpl account opens with at least ${account?.minimumOpen ?? 100} AUSD. You hold ${money(account?.walletAusd ?? 0, "USD", { compact: false })}.`}
        </Caption>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="100"
          placeholderTextColor={theme.colors.faint}
          inputMode="decimal"
          style={styles.input}
        />
        <Button
          label={busy ? (status ?? "Depositing…") : "Deposit"}
          variant="ink"
          tall
          loading={busy}
          disabled={!(Number(amount) > 0)}
          onPress={() => void deposit()}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
  },
  muted: { color: theme.colors.muted, fontWeight: "600" },
  card: { gap: 10, padding: 16, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  position: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.lineStrong },
  sheet: { gap: 10, padding: 20, paddingBottom: 32 },
  input: {
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 16,
    fontSize: theme.type.body.size,
    color: theme.colors.text,
  },
  chips: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  chip: { paddingHorizontal: 16, height: 40, borderRadius: 999, justifyContent: "center", backgroundColor: theme.colors.surfaceAlt },
  chipOn: { backgroundColor: theme.colors.ink },
  chipText: { fontSize: theme.type.label.size, fontWeight: "700", color: theme.colors.text },
  chipTextOn: { color: theme.colors.onInk },
  error: { fontSize: theme.type.label.size, fontWeight: "600", color: theme.colors.neg },
  ok: { fontSize: theme.type.body.size, fontWeight: "600", color: theme.colors.pos },
});
