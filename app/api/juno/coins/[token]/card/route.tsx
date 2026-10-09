import { ImageResponse } from "next/og";
import { isAddress } from "viem";

import { junoError, junoOptions } from "@/lib/juno/api";
import { hydratePool } from "@/lib/juno/chain";
import { recallContent } from "@/lib/juno/ipfs-cache";
import { mediaCid } from "@/lib/juno/media";
import { isMainnet } from "@/lib/juno/network";
import { getPool } from "@/lib/juno/registry";
import { compactAmount, usd } from "@/lib/juno/receipt-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /coins/<token>/card` → a 1200×630 PNG of a coin, for sharing it.
 *
 * A shared coin was a bare link. The share now carries a picture: the post,
 * its ticker, market cap and day change, and its holders, read from the chain
 * like the coin page. A figure that could not be read is left off.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isAddress(token)) return junoError("token is not an address", 400);
  const row = await getPool(token).catch(() => null);
  if (!row) return junoError("No such coin on Juno", 404);
  const coin = await hydratePool(row, { detailed: true }).catch(() => null);
  if (!coin) return junoError("The coin could not be read just now. Try again in a moment.", 503);

  const cid = mediaCid(row.posterUrl) ?? (row.mediaMime?.startsWith("video") ? null : mediaCid(row.mediaUrl));
  const held = cid ? recallContent(cid) : null;
  const image = held && /^image\/(png|jpe?g)$/i.test(held.type) ? `data:${held.type};base64,${Buffer.from(held.bytes).toString("base64")}` : null;
  const change = coin.marketCapChangePct;

  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", backgroundColor: "#DCE7D5", padding: 40, fontFamily: "sans-serif" }}>
      <div style={{ flex: 1, display: "flex", backgroundColor: "#FFFFFF", borderRadius: 36, overflow: "hidden" }}>
        {image ? (
          // biome-ignore lint/performance/noImgElement: satori draws <img>, not next/image
          <img src={image} width={550} height={550} style={{ objectFit: "cover" }} alt="" />
        ) : (
          <div style={{ display: "flex", width: 550, height: 550, backgroundColor: "#12150E" }} />
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "44px 44px" }}>
          <div style={{ display: "flex", fontSize: 26, color: "#5C6655" }}>{`juno · on Monad${isMainnet() ? "" : " testnet"}`}</div>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: "#12150E", letterSpacing: -2, marginTop: 24 }}>{`$${coin.symbol}`}</div>
          <div style={{ display: "flex", fontSize: 28, color: "#5C6655", marginTop: 6 }}>{coin.name.slice(0, 40)}</div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 800, color: "#12150E", marginTop: "auto" }}>
            {coin.marketCapCurrency === "USD" ? usd(coin.marketCap) : `${compactAmount(coin.marketCap)} ${coin.marketCapCurrency}`}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 26, color: "#5C6655" }}>
            <div style={{ display: "flex" }}>market cap</div>
            {change !== null ? (
              <div style={{ display: "flex", color: change >= 0 ? "#0E9F6E" : "#D92D20", fontWeight: 800 }}>{`${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(1)}% 24h`}</div>
            ) : null}
            {coin.holders !== null ? <div style={{ display: "flex" }}>{`${coin.holders} holders`}</div> : null}
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 24, fontWeight: 800, color: "#12150E", backgroundColor: "#D6FF3D", borderRadius: 999, padding: "10px 22px", alignSelf: "flex-start" }}>
            Every post is a market
          </div>
        </div>
      </div>
    </div>,
    { width: 1200, height: 630, headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } },
  );
}
