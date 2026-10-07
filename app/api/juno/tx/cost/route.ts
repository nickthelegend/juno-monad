import { isHash, zeroAddress, type Hash } from "viem";

import { CallerError, junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { publicClient } from "@/lib/juno/client";
import { localFork } from "@/lib/juno/network";
import { fetchPythPrice, PYTH_FEEDS, quoteTokenUsdPrice } from "@/lib/juno/pyth";
import { ethereumFee, ethereumGasPrice, monadFee } from "@/lib/juno/tx-cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /tx/cost?hash=0x…` — what a confirmed transaction cost on Monad, and
 * what the same gas would cost on Ethereum mainnet now.
 *
 * Asked for after a trade lands, so the receipt shows its time at once and
 * this line a moment later; a slow Ethereum endpoint never slows a trade.
 * `ethereum` is null when Ethereum's gas price could not be read, and each
 * dollar figure is null when its price feed could not be.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const hash = new URL(request.url).searchParams.get("hash") ?? "";
    if (!isHash(hash)) throw new CallerError("hash is not a transaction hash");
    const client = publicClient();
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: hash as Hash }).catch(() => null),
      client.getTransactionReceipt({ hash: hash as Hash }).catch(() => null),
    ]);
    if (!transaction || !receipt) throw new CallerError("No confirmed transaction with that hash", 404);

    const [monUsd, gasPrice, eth] = await Promise.all([
      quoteTokenUsdPrice(zeroAddress).catch(() => null),
      ethereumGasPrice(),
      fetchPythPrice(PYTH_FEEDS["Crypto.ETH/USD"]).catch(() => null),
    ]);

    const monad = monadFee({
      gasUsed: receipt.gasUsed,
      gasLimit: transaction.gas,
      effectiveGasPrice: receipt.effectiveGasPrice,
      localFork: localFork(),
      monUsd,
    });
    const ethereum = gasPrice
      ? {
          ...ethereumFee({ gasUsed: receipt.gasUsed, gasPriceWei: gasPrice.wei, ethUsd: eth?.priceUsd ?? null }),
          gasPriceSource: gasPrice.source,
          ethUsdAgeSeconds: eth?.ageSeconds ?? null,
        }
      : null;

    return junoJson({
      hash,
      blockNumber: Number(receipt.blockNumber),
      localFork: localFork(),
      monad,
      ethereum,
    });
  });
}
