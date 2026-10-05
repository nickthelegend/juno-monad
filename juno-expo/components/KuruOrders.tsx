import { useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, Text, TextInput, View } from "react-native";

import { BottomSheet } from "./BottomSheet";
import { Button, Caption, Label, Mono, Pill, Segmented, RETRY_HINT } from "./kit";
import { juno, type Coin, type KuruOrder } from "../lib/api";
import { bookPrice, money, tokens, useApi } from "../lib/useApi";
import { useWallet } from "../lib/wallet";
import { theme } from "../theme";

/**
 * A graduated coin's Kuru book, from the holder's side: their resting orders,
 * what Kuru is holding for them, and a way to place a limit order.
 *
 * Limit orders on Kuru are paid from Kuru's MarginAccount, and their fills
 * land there too — not in the wallet. So this card shows that balance plainly
 * and offers to withdraw it, rather than letting a filled order look like it
 * vanished. Every number is read from the chain at the time of the read: the
 * indexer (or, without one, the receipts Juno recorded) names the orders;
 * the book says what is left of each.
 */
export function KuruOrdersCard({ coin, onChanged }: { coin: Coin; onChanged: () => void }) {
  const wallet = useWallet();
  const owner = wallet.address;
  const state = useApi(
    () => (owner ? juno.kuruOrders(coin.address, owner) : Promise.resolve(null)),
    [coin.address, owner],
  );
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const followUps = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => followUps.current.forEach(clearTimeout), []);

  if (!owner) return null;

  const run = async (label: string, build: () => Promise<{ steps: Parameters<typeof wallet.signAndSubmit>[0] }>) => {
    setBusy(label);
    setError(null);
    try {
      const { steps } = await build();
      await wallet.signAndSubmit(steps);
      state.refresh();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not go through");
    } finally {
      setBusy(null);
    }
  };

  const orders = state.data?.orders ?? null;
  const balances = state.data?.balances;
  const held = balances && (balances.mon > 0 || balances.tokens > 0);

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Label style={{ fontWeight: "700", flex: 1 }}>Your orders on Kuru</Label>
        <Button label="Limit order" variant="quiet" onPress={() => setSheet(true)} />
      </View>

      {state.loading ? (
        <Caption>Reading the book…</Caption>
      ) : orders === null ? (
        <Caption>{`Your resting orders could not be read just now. ${RETRY_HINT}`}</Caption>
      ) : orders.length === 0 ? (
        <Caption>No resting orders. A limit order waits on the book at your price.</Caption>
      ) : (
        orders.map((order) => (
          <OrderRow
            key={order.orderId}
            order={order}
            symbol={coin.symbol}
            busy={busy === order.orderId}
            onCancel={() => void run(order.orderId, () => juno.kuruCancel({ token: coin.address, owner, orderIds: [order.orderId] }))}
          />
        ))
      )}

      {held ? (
        <View style={styles.held}>
          <Caption style={{ flex: 1 }}>
            Kuru holds {balances.tokens > 0 ? `${tokens(balances.tokens)} ${coin.symbol}` : ""}
            {balances.tokens > 0 && balances.mon > 0 ? " and " : ""}
            {balances.mon > 0 ? money(balances.mon, "MON", { compact: false }) : ""} for you — fills and change from your
            orders.
          </Caption>
          <Button
            label={busy === "withdraw" ? "Withdrawing…" : "Withdraw"}
            variant="ink"
            loading={busy === "withdraw"}
            onPress={() => void run("withdraw", () => juno.kuruWithdraw({ token: coin.address, owner }))}
          />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <LimitSheet
        visible={sheet}
        coin={coin}
        onClose={() => setSheet(false)}
        onPlaced={() => {
          setSheet(false);
          state.refresh();
          onChanged();
        }}
        // The list above the receipt has to agree with it: "No resting
        // orders" over "Bid placed" read as a failure until Done was pressed.
        // The list comes from the indexer, a block or two behind the receipt,
        // so it is read again over the next few seconds.
        onSubmitted={() => {
          for (const ms of [0, 2_000, 5_000, 10_000]) {
            followUps.current.push(setTimeout(() => state.refresh(), ms));
          }
          onChanged();
        }}
      />
    </View>
  );
}

function OrderRow({
  order,
  symbol,
  busy,
  onCancel,
}: {
  order: KuruOrder;
  symbol: string;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pill label={order.isBuy ? "Bid" : "Offer"} tone={order.isBuy ? "pos" : "neg"} />
      <Mono style={{ flex: 1 }}>
        {tokens(order.remaining)} {symbol} @ {bookPrice(order.price)}
      </Mono>
      <Button label={busy ? "Cancelling…" : "Cancel"} variant="quiet" loading={busy} onPress={onCancel} />
    </View>
  );
}

const SIDES = [
  { id: "buy" as const, label: "Bid" },
  { id: "sell" as const, label: "Offer" },
];

/**
 * Place a limit order: a price and a size, resting on the book until it fills
 * or is cancelled. Prefilled at the best price on the chosen side, so the
 * obvious order is one tap; the server snaps it to the market's tick and says
 * what it will lock before anything is signed.
 */
function LimitSheet({
  visible,
  coin,
  onClose,
  onPlaced,
  onSubmitted,
}: {
  visible: boolean;
  coin: Coin;
  onClose: () => void;
  onPlaced: () => void;
  /** The order landed; the sheet stays open on its receipt. */
  onSubmitted: () => void;
}) {
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const best = side === "buy" ? coin.kuru?.bestBid : coin.kuru?.bestAsk;
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  // Each opening starts clean: a sheet reopened after an order was placed
  // must not still be showing that order's receipt.
  useEffect(() => {
    if (!visible) return;
    setPrice("");
    setAmount("");
    setPlaced(null);
    setStatus(null);
    setError(null);
  }, [visible]);

  const priceValue = Number(price || (best ? String(best) : "0"));
  const amountValue = Number(amount || "0");
  const valid = priceValue > 0 && amountValue > 0;
  const locks = side === "buy" ? priceValue * amountValue : amountValue;

  const place = async () => {
    if (!wallet.address || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const built = await juno.kuruOrder({
        token: coin.address,
        owner: wallet.address,
        side,
        price: priceValue,
        amount: amountValue,
      });
      const results = await wallet.signAndSubmit(built.steps, (step) =>
        setStatus(step.total > 1 ? `${step.label}… (${step.index + 1}/${step.total})` : `${step.label}…`),
      );
      const last = results[results.length - 1];
      setPlaced(last.hash);
      onSubmitted();
      setStatus(
        `${side === "buy" ? "Bid" : "Offer"} placed: ${tokens(built.amount)} ${coin.symbol} at ${bookPrice(built.price)}.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order did not go through");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={placed ? onPlaced : onClose} dismissable={!busy}>
      <View style={styles.sheet}>
        <Label style={{ fontWeight: "800", fontSize: 18 }}>Limit order on Kuru</Label>
        <Segmented items={SIDES} value={side} onChange={(next) => {
          setSide(next);
          setPrice("");
          setPlaced(null);
          setStatus(null);
        }} />
        <Caption>Price, MON per {coin.symbol}</Caption>
        <TextInput
          value={price}
          onChangeText={setPrice}
          // The book's price to four figures: the full float ("0.001025902600290073")
          // is noise, and the server snaps whatever is sent to Kuru's tick anyway.
          placeholder={best ? String(Number(best.toPrecision(4))) : "0.0"}
          placeholderTextColor={theme.colors.faint}
          inputMode="decimal"
          style={styles.input}
        />
        <Caption>Amount, {coin.symbol}</Caption>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          placeholder="1000"
          placeholderTextColor={theme.colors.faint}
          inputMode="decimal"
          style={styles.input}
        />
        <Caption>
          {valid
            ? side === "buy"
              ? `Locks about ${money(locks, "MON", { compact: false })} in Kuru until it fills or you cancel.`
              : `Locks ${tokens(locks)} ${coin.symbol} in Kuru until it fills or you cancel.`
            : "It rests on the book at your price. Fills land in your Kuru balance on this page."}
        </Caption>
        {placed ? (
          <>
            <Text style={styles.ok}>{status}</Text>
            {juno.explorable() ? (
              <Button label="View the transaction" variant="quiet" onPress={() => Linking.openURL(juno.explorer("tx", placed))} />
            ) : null}
            <Button label="Done" variant="lime" tall onPress={onPlaced} />
          </>
        ) : (
          <Button
            label={busy ? (status ?? "Placing…") : side === "buy" ? "Place bid" : "Place offer"}
            variant={side === "buy" ? "buy" : "sell"}
            tall
            loading={busy}
            disabled={!valid}
            onPress={() => void place()}
          />
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 16,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    marginTop: 16,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  held: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6 },
  sheet: { gap: 10, padding: 20, paddingBottom: 32 },
  input: {
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 16,
    fontSize: theme.type.body.size,
    color: theme.colors.text,
  },
  error: { fontSize: theme.type.label.size, fontWeight: "600", color: theme.colors.neg },
  ok: { fontSize: theme.type.body.size, fontWeight: "600", color: theme.colors.pos },
});
