import { isAddress, getAddress } from "viem";

import { CallerError, junoHandler, junoJson, junoOptions } from "@/lib/juno/api";
import { perpRisk } from "@/lib/juno/perpl";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET ?owner=` — risk on Perpl: each market's funding (now, annualised, the
 * last day's payments and what they cost a $1,000 long), premium to the
 * oracle, realised volatility and 24h range; with an owner, each open
 * position's effective leverage, distance to liquidation, margin health and
 * daily funding.
 */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const raw = new URL(request.url).searchParams.get("owner");
    if (raw && !isAddress(raw)) throw new CallerError("owner is not a Monad address");
    return junoJson(await perpRisk(raw ? getAddress(raw) : undefined));
  });
}
