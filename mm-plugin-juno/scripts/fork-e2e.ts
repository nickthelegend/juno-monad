/**
 * The plugin's trade path end to end on a LOCAL FORK of Monad testnet.
 *
 *   JUNO_API_URL=http://localhost:3150 FORK_RPC=http://127.0.0.1:8555 \
 *     npx tsx scripts/fork-e2e.ts <curve coin> <graduated coin>
 *
 * Runs the same `trade()` the `mm juno buy|sell` commands run, against Juno's
 * API on the fork. The one stand-in is the executor: `mm` submits through
 * MetaMask's wallet service (sign-in, Guard mode, 2FA), which a fork cannot
 * reach, so a fresh fork key signs and sends each step instead. It takes the
 * same request (`{kind: "transaction", chainId, transaction, intent}`) and
 * answers the same shape. Refuses a non-local RPC.
 */

import { createPublicClient, createWalletClient, erc20Abi, type Hex, http, parseEther, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { type Executor, JunoApi } from "../src/lib/juno";
import { trade } from "../src/lib/trade";

const RPC = process.env.FORK_RPC ?? "http://127.0.0.1:8555";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(RPC)) throw new Error("fork-e2e only runs against a local fork");
const API = process.env.JUNO_API_URL ?? "http://localhost:3150";
const [curveCoin, pairCoin] = process.argv.slice(2) as Hex[];

const chain = createPublicClient({ transport: http(RPC) });
const account = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account, transport: http(RPC) });
const intents: string[] = [];

/** A stand-in for `ctx.walletExecutor()`: same request and result shape, a fork key instead of MetaMask's wallet service. */
const executor: Executor = async (request) => {
  intents.push(request.intent ?? "");
  const hash = await wallet.sendTransaction({
    chain: null,
    to: request.transaction.to as Hex,
    data: request.transaction.data as Hex,
    value: BigInt(request.transaction.value),
  });
  const receipt = await chain.waitForTransactionReceipt({ hash });
  return { kind: "transaction", hash, status: receipt.status === "success" ? "confirmed" : "failed" };
};

const io = { progress: (label?: string) => label && console.log(`  … ${label}`), signal: new AbortController().signal } as never;
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
const balance = (token: Hex) => chain.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });

async function main() {
  const config = await new JunoApi(API).config();
  if (!config.localFork) throw new Error("The API is not on a local fork.");
  await chain.request({ method: "anvil_setBalance" as never, params: [account.address, toHex(parseEther("20"))] as never });
  console.log(`wallet ${account.address} (fresh, 20 fork MON)\n`);

  const curveBuy = await trade(io, executor, { api: API, token: curveCoin, side: "buy", wallet: account.address, amountIn: 1 });
  check("buy on a curve lands", curveBuy.transactions.length === 1 && curveBuy.venue === "curve", curveBuy.transactions.map((t) => t.hash));
  const held = await balance(curveCoin);
  check("the wallet holds the coin", held > 0n, held.toString());
  check("the intent says what it is", intents[0].startsWith(`Juno: buy 1 MON of ${curveCoin} on its curve`), intents[0]);

  const pairBuy = await trade(io, executor, { api: API, token: pairCoin, side: "buy", wallet: account.address, amountIn: 0.5 });
  check("buy on a graduated coin's Uniswap v2 pair lands", pairBuy.venue === "uniswap-v2" && pairBuy.transactions.length === 1, pairBuy.transactions.map((t) => t.hash));

  const half = await trade(io, executor, { api: API, token: curveCoin, side: "sell", wallet: account.address, sellFraction: 0.5 });
  const after = await balance(curveCoin);
  check("sell 50% leaves half, to the wei", half.transactions.length === 1 && after === held - held / 2n, `${held} → ${after}`);

  await trade(io, executor, { api: API, token: curveCoin, side: "sell", wallet: account.address, sellFraction: 1 });
  check("sell 100% leaves nothing", (await balance(curveCoin)) === 0n);

  const refused = await trade(io, executor, { api: API, token: curveCoin, side: "sell", wallet: account.address, sellFraction: 1 }).catch((e) => e);
  check("selling what it does not hold is refused by Juno before anything is signed", refused instanceof Error && intents.length === 4, refused?.message);

  const portfolio = await new JunoApi(API).portfolio(account.address);
  check("portfolio shows the graduated coin still held", portfolio.positions.some((p) => p.token.toLowerCase() === pairCoin.toLowerCase() && p.balance > 0), portfolio.positions.map((p) => p.symbol));

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
