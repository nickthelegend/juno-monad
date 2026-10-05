// LOCAL FORK ONLY. A market maker for the fork (its two keys are made in .juno/, which is gitignored).
//
// The fork's Perpl book is frozen at fork time and nobody refills it, so every
// test fill empties it a little more. Two fork-only keys rest real post-only
// orders around BTC's mark: A sells 0.01 BTC at +0.2%, B buys 0.01 BTC at
// -0.2%. A taker's long fills against A; its close fills against B.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, maxUint256, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { perplExchangeAbi } from "../../lib/juno/perpl-abi";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8555";
const EX = "0x1964C32f0bE608E7D29302AFF5E61268E72080cc";
const AUSD = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const PERP = 16n;
const chain = { id: 10143, name: "fork", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const pub = createPublicClient({ chain, transport: http(RPC) });
if ((await pub.getChainId()) !== 10143) throw new Error("not the fork");
await pub.request({ method: "anvil_nodeInfo" as never }); // throws off anvil

const erc20 = parseAbi(["function approve(address,uint256) returns (bool)"]);
const info = await pub.readContract({ address: EX, abi: perplExchangeAbi, functionName: "getPerpetualInfoV2", args: [PERP] });
const mark = info.markPNS;
const lot = 10n ** BigInt(info.lotDecimals) / 100n; // 0.01 BTC

mkdirSync(".juno", { recursive: true });
for (const side of ["a", "b"] as const) {
  const file = `.juno/perpl-maker-${side}.key`;
  if (!existsSync(file)) writeFileSync(file, generatePrivateKey());
  const account = privateKeyToAccount(readFileSync(file, "utf8").trim() as Hex);
  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  await pub.request({ method: "anvil_setBalance" as never, params: [account.address, "0x56BC75E2D63100000"] as never });
  const has = await pub
    .readContract({ address: EX, abi: perplExchangeAbi, functionName: "getAccountByAddr", args: [account.address] })
    .then(() => true, () => false);
  if (!has) {
    const { execFileSync } = await import("node:child_process");
    execFileSync("scripts/fork/perpl-keeper.sh", ["fund", account.address, "2000"]);
    await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: AUSD, abi: erc20, functionName: "approve", args: [EX, maxUint256] }) });
    await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: EX, abi: perplExchangeAbi, functionName: "createAccount", args: [2_000_000_000n] }) });
  }
  const sell = side === "a";
  // Post-only must not cross what already rests (the fork's frozen orders
  // among it): the ask stays above the best bid, the bid below the best ask.
  const book = await pub.readContract({ address: EX, abi: perplExchangeAbi, functionName: "getPerpetualInfoV2", args: [PERP] });
  const bestBid = book.basePricePNS + book.maxBidPriceONS;
  const bestAsk = book.basePricePNS + book.minAskPriceONS;
  const want = sell ? (mark * 1002n) / 1000n : (mark * 998n) / 1000n;
  const pricePNS = sell ? (want > bestBid ? want : bestBid + 1n) : want < bestAsk ? want : bestAsk - 1n;
  const hash = await wallet.writeContract({
    address: EX,
    abi: perplExchangeAbi,
    functionName: "execOrder",
    args: [
      {
        orderDescId: BigInt(Date.now()),
        perpId: PERP,
        orderType: sell ? 1 : 0,
        orderId: 0n,
        pricePNS,
        lotLNS: lot,
        expiryBlock: 0n,
        postOnly: true,
        fillOrKill: false,
        immediateOrCancel: false,
        maxMatches: 100n,
        leverageHdths: 1000n,
        lastExecutionBlock: 0n,
        amountCNS: 0n,
        maxNegPnlCollatBPS: 1000n,
      },
    ],
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const scale = 10 ** Number(info.priceDecimals);
  console.log(`maker ${side} ${account.address.slice(0, 8)}: ${sell ? "sells" : "buys"} 0.01 BTC at $${(Number(pricePNS) / scale).toFixed(1)} (mark $${(Number(mark) / scale).toFixed(1)}) — ${receipt.status}, ${receipt.logs.length} logs`);
}
