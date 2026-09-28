import { zeroAddress } from "viem";

import { junoError, junoJson, junoOptions, junoRead } from "@/lib/juno/api";
import { junoTokenAbi } from "@/lib/juno/abi";
import { publicClient } from "@/lib/juno/client";
import { MON, quoteTokenFor, weiToUi } from "@/lib/juno/launchpad";
import { requireAddress } from "../../_lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/**
 * What one wallet holds of one token.
 *
 * The buy sheet calls its balance line "the number that decides whether any of
 * the rest is possible". The portfolio endpoint knows coin balances but not the
 * *quote* side, which is the side a buy spends from — so this answers both.
 *
 * Native MON is the account balance, asked for with the zero address — the
 * same spelling the launchpad uses for a MON-quoted pool. Anything else is an
 * ERC-20 `balanceOf`, with its `decimals` and `symbol` read alongside so the
 * number can be scaled and labelled. The three reads go out together and the
 * shared client folds them into one Multicall3 `eth_call`.
 *
 * `null` rather than `0` when the read fails, for the reason everything here
 * returns null: "we could not look" is not "you have nothing", and only one of
 * those should grey out the button. `symbol` and `decimals` are null only in
 * the same case, for a token this server does not already know.
 *
 * `GET ?wallet=&token=`.
 */
export async function GET(request: Request) {
  return junoRead(async () => {
    const url = new URL(request.url);
    const rawWallet = url.searchParams.get("wallet") ?? "";
    const rawToken = url.searchParams.get("token") ?? "";
    if (!rawWallet) return junoError("A wallet is required");
    if (!rawToken) return junoError("A token is required");
    const wallet = requireAddress(rawWallet, "wallet");
    const token = requireAddress(rawToken, "token");

    const client = publicClient();

    if (token === zeroAddress) {
      const wei = await client.getBalance({ address: wallet }).catch(() => null);
      return junoJson({
        wallet,
        token,
        symbol: MON.symbol,
        decimals: MON.decimals,
        balance: wei === null ? null : weiToUi(wei, MON.decimals),
      });
    }

    // A quote token's symbol and decimals are known; only the balance is asked.
    const known = quoteTokenFor(token);
    const [raw, decimals, symbol] = await Promise.all([
      client
        .readContract({ address: token, abi: junoTokenAbi, functionName: "balanceOf", args: [wallet] })
        .catch(() => null),
      known
        ? Promise.resolve(known.decimals)
        : client
            .readContract({ address: token, abi: junoTokenAbi, functionName: "decimals" })
            .then(Number)
            .catch(() => null),
      known
        ? Promise.resolve(known.symbol)
        : client
            .readContract({ address: token, abi: junoTokenAbi, functionName: "symbol" })
            .catch(() => null),
    ]);

    return junoJson({
      wallet,
      token,
      symbol,
      decimals,
      // Without the decimals a raw balance cannot be scaled, and a guess at
      // them would be off by powers of ten — so that is unknown too.
      balance: raw === null || decimals === null ? null : weiToUi(raw, decimals),
    });
  });
}
