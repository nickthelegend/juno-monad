import { loadPortfolio } from "@/lib/juno/portfolio";
import { junoHandler, junoJson, junoOptions } from "@/lib/juno/api";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** What a wallet holds across Juno pools, with cost basis and P&L. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ wallet: string }> },
) {
  return junoHandler(async () => {
    const { wallet } = await params;
    return junoJson(await loadPortfolio(wallet));
  });
}
