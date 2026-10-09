import { describe, expect, it } from "vitest";

import { compactAmount, smallAmount, tradeLine, usd, VENUE_LABEL } from "@/lib/juno/receipt-card";

/** The receipt card's sentences: what it says about a trade and its cost. */
describe("receipt card text", () => {
  it("says the trade in one line, with the venue it filled on", () => {
    const trade = { side: "buy" as const, baseAmount: 1_234_567, quoteAmount: 0.1, quoteSymbol: "MON", venue: "kuru" as const, symbol: "GRADKURU", name: "Grad" };
    expect(`${tradeLine(trade)}, ${VENUE_LABEL[trade.venue]}`).toBe("Bought 1.23M $GRADKURU for 0.10 MON, filled on Kuru");
    expect(tradeLine({ ...trade, side: "sell", baseAmount: 500, quoteAmount: 0.0123 })).toBe("Sold 500 $GRADKURU for 0.012 MON");
  });

  it("keeps two significant figures on a small fee instead of rounding it to zero", () => {
    expect(smallAmount(0.0063)).toBe("0.0063");
    expect(smallAmount(0.000052)).toBe("0.000052");
    expect(usd(0.00021)).toBe("$0.00021");
    expect(usd(0.84)).toBe("$0.84");
    expect(usd(1234.4)).toBe("$1,234");
  });

  it("writes milliseconds as they were measured", () => {
    expect(compactAmount(312)).toBe("312");
    expect(compactAmount(1_234)).toBe("1,234");
  });
});
