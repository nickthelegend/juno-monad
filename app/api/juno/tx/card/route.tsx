import { ImageResponse } from "next/og";
import { isHash, type Hash } from "viem";

import { junoError, junoJson, junoOptions } from "@/lib/juno/api";
import { compactAmount, loadReceiptCard, smallAmount, tradeLine, usd, VENUE_LABEL, type ReceiptCard } from "@/lib/juno/receipt-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /tx/card?hash=0x…` → a 1200×630 PNG of a trade's receipt, for posting.
 * `&format=json` answers the same figures as data.
 *
 * The speed receipt is Juno's best moment and lived only in the sheet that
 * closed after it. This draws the same receipt as an image anyone can share
 * or attach: the measured milliseconds, Monad's finality, the trade, and its
 * cost against Ethereum. Every figure is the server's own (see
 * `loadReceiptCard`); none is taken from the request, so a card cannot be
 * made to claim a time nobody measured.
 */
export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get("hash") ?? "";
  if (!isHash(hash)) return junoError("hash is not a transaction hash", 400);
  let card: ReceiptCard | null;
  try {
    card = await loadReceiptCard(hash as Hash);
  } catch (error) {
    console.error("[juno card]", error);
    return junoError("The receipt could not be read just now. Try again in a moment.", 503);
  }
  if (!card) return junoError("No confirmed transaction with that hash", 404);
  // The same figures as data, so what the image says can be checked.
  if (new URL(request.url).searchParams.get("format") === "json") {
    const { image, ...figures } = card;
    return junoJson({ ...figures, image: image !== null });
  }
  return new ImageResponse(<Card card={card} />, {
    width: 1200,
    height: 630,
    headers: {
      // A confirmed transaction's card only changes as Ethereum's gas moves.
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

const INK = "#12150E";
const MUTED = "#5C6655";
const LIME = "#D6FF3D";
const SAGE = "#DCE7D5";
const POS = "#0E9F6E";

function Card({ card }: { card: ReceiptCard }) {
  const chain = card.network === "monad" ? "Monad mainnet" : "Monad testnet";
  const network = card.localFork ? `a local fork of ${chain}` : chain;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: SAGE, padding: 40, fontFamily: "sans-serif" }}>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#FFFFFF",
          borderRadius: 36,
          padding: "40px 48px",
          boxShadow: "0 8px 40px rgba(18,21,14,0.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", width: 44, height: 44, borderRadius: 22, backgroundColor: INK, alignItems: "center", justifyContent: "center" }}>
            <div style={{ display: "flex", width: 18, height: 18, borderRadius: 9, backgroundColor: LIME }} />
          </div>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: INK, letterSpacing: -1 }}>juno</div>
          <div style={{ display: "flex", fontSize: 22, color: MUTED, marginLeft: 6 }}>{`receipt · ${network}`}</div>
        </div>

        <div style={{ display: "flex", marginTop: 26, gap: 56, alignItems: "flex-end" }}>
          {card.executedMs !== null ? (
            <Timer label="Executed" value={card.executedMs} caption={`broadcast to receipt${card.localFork ? " on the fork" : ""}, measured by Juno`} color={INK} />
          ) : null}
          {card.finalMs !== null ? (
            <Timer label="Final" value={card.finalMs} caption={`${chain}'s finality now, live median`} color={POS} />
          ) : null}
          {card.image ? (
            <div style={{ display: "flex", marginLeft: "auto" }}>
              {/* biome-ignore lint/performance/noImgElement: satori draws <img>, not next/image */}
              <img src={card.image} width={132} height={132} style={{ borderRadius: 26, objectFit: "cover" }} alt="" />
            </div>
          ) : null}
        </div>

        {card.trade ? (
          <div style={{ display: "flex", marginTop: 18, fontSize: 30, fontWeight: 800, color: INK, letterSpacing: -0.5 }}>
            {`${tradeLine(card.trade)}, ${VENUE_LABEL[card.trade.venue]}`}
          </div>
        ) : null}

        <div style={{ display: "flex", marginTop: 22, gap: 18 }}>
          <Cost
            label="Paid on Monad"
            value={`${smallAmount(card.fee.mon)} MON`}
            caption={card.fee.billed === "limit" ? "billed on the gas limit" : "billed on gas used (fork)"}
          />
          {card.ethereum ? (
            <Cost
              label="Same gas on Ethereum now"
              value={card.ethereum.usd === null ? `${smallAmount(card.ethereum.eth)} ETH` : usd(card.ethereum.usd)}
              caption="12 s blocks"
            />
          ) : null}
        </div>

        <div style={{ display: "flex", marginTop: "auto", fontSize: 20, color: MUTED }}>
          {`Block #${card.blockNumber.toLocaleString("en-US")} · tx ${card.hash.slice(0, 10)}…${card.hash.slice(-8)}`}
        </div>
      </div>
    </div>
  );
}

function Timer({ label, value, caption, color }: { label: string; value: number; caption: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", fontSize: 20, fontWeight: 800, letterSpacing: 1, color: MUTED }}>{label.toUpperCase()}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ display: "flex", fontSize: 104, fontWeight: 800, letterSpacing: -5, color, lineHeight: 1 }}>{compactAmount(value)}</div>
        <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: POS }}>ms</div>
      </div>
      <div style={{ display: "flex", fontSize: 18, color: MUTED, maxWidth: 360 }}>{caption}</div>
    </div>
  );
}

function Cost({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, backgroundColor: "#F5F7F2", borderRadius: 22, padding: "14px 24px" }}>
      <div style={{ display: "flex", fontSize: 20, fontWeight: 700, color: MUTED }}>{label}</div>
      <div style={{ display: "flex", fontSize: 32, fontWeight: 800, color: INK }}>{value}</div>
      <div style={{ display: "flex", fontSize: 17, color: MUTED }}>{caption}</div>
    </div>
  );
}
