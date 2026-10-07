import { getAddress, isAddress, isHash } from "viem";

import { CallerError, junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { localFork, rpcEndpoint } from "@/lib/juno/network";
import { askTxpool, readAddressStatus, readStatus } from "@/lib/juno/txpool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * `GET /tx/status?hash=0x…` or `?address=0x…` — what Monad's transaction
 * pool says about a transaction, or about everything an address has in
 * flight. Asked of the chain this deployment submits to; a local fork has no
 * txpool methods and answers `supported: false`.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const url = new URL(request.url);
    const hash = url.searchParams.get("hash");
    const address = url.searchParams.get("address");
    const where = localFork() ? "local fork" : "monad";
    if (hash) {
      if (!isHash(hash)) throw new CallerError("hash is not a transaction hash");
      return junoJson({ hash, where, ...readStatus(await askTxpool(rpcEndpoint(), "txpool_statusByHash", hash)) });
    }
    if (address) {
      if (!isAddress(address)) throw new CallerError("address is not an address");
      return junoJson({ address: getAddress(address), where, ...readAddressStatus(await askTxpool(rpcEndpoint(), "txpool_statusByAddress", getAddress(address))) });
    }
    throw new CallerError("Ask about a hash or an address");
  });
}
