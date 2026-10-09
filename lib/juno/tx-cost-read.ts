import "server-only";

import { zeroAddress, type Hash } from "viem";

import { publicClient } from "./client";
import { localFork } from "./network";
import { fetchPythPrice, PYTH_FEEDS, quoteTokenUsdPrice } from "./pyth";
import { ethereumFee, ethereumGasPrice, monadFee } from "./tx-cost";

/**
 * A confirmed transaction's cost on Monad, and the same gas on Ethereum
 * mainnet now (`tx-cost.ts` has the rules). Shared by `GET /tx/cost` and the
 * receipt card. Null when there is no confirmed transaction with that hash.
 */
export async function readTxCost(hash: Hash) {
  const client = publicClient();
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash }).catch(() => null),
    client.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!transaction || !receipt) return null;

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

  return {
    hash,
    blockNumber: Number(receipt.blockNumber),
    localFork: localFork(),
    monad,
    ethereum,
  };
}
