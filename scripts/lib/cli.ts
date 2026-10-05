/**
 * Shared plumbing for the juno:* CLI scripts.
 *
 * ## Why no script imports a `server-only` module
 *
 * `server-only` resolves to a module that throws on import unless the
 * `react-server` export condition is set, which only Next's bundler does. tsx
 * is not a bundler, so the scripts — and this file — only reach `lib/juno`
 * modules that do not carry it: `network`, `client`, `rpc`, `abi`, `curves`,
 * `curve-math`, `economics`, `launchpad`, `pinata`, `pyth`, `format`. That set
 * is exactly what building, quoting and sending a launchpad call needs. What
 * is `server-only` (the registry, posts, the trade store) is reached over HTTP
 * through the running app, which is also the path the phone takes.
 *
 * ## Signing
 *
 * A local key (see `./key.ts`) signs with a viem wallet client. Calls are built
 * by the same `lib/juno/launchpad.ts` functions the API uses, so a script run is
 * a faithful rehearsal of what the app sends.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  BaseError,
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { junoLaunchpadAbi, junoTokenAbi } from "../../lib/juno/abi";
import type { ContractCall } from "../../lib/juno/launchpad";
import { chain, explorer, isMainnet, launchpadAddress, localFork, network, rpcEndpoint } from "../../lib/juno/network";
import { KEY_PATH, readScriptKey } from "./key";

export const FAUCET_URL = "https://faucet.monad.xyz";

/**
 * Where the Juno API answers: `JUNO_API_URL`, else the API's dev port.
 *
 * Not `NEXT_PUBLIC_SITE_URL`. That is the web app's origin, and on a local
 * stack the web app (Expo, :3000) and the API (Next, :3100) are two servers —
 * Expo answers any path, `/api/juno/pools` included, with its page and a 200,
 * so a script that posted there reported a coin recorded that was not.
 */
export function apiBase(): string {
  return (process.env.JUNO_API_URL?.trim() || "http://localhost:3100").replace(/\/$/, "");
}

/** The web app's origin, for the coin links a script prints. */
export function appBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Explorer links for what a script prints. On a local fork everything a
 * script sends or deploys exists only on the fork, so a MonadVision link would
 * open on nothing: print the bare hash or address and say where it lives.
 */
const onFork = (value: string) => `${value} (local fork, not on MonadVision)`;
export const links = {
  tx: (hash: string) => (localFork() ? onFork(hash) : explorer.tx(hash)),
  address: (address: string) => (localFork() ? onFork(address) : explorer.address(address)),
  token: (address: string) => (localFork() ? onFork(address) : explorer.token(address)),
};

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** A numeric flag, refused with a sentence rather than becoming NaN downstream. */
export function numberArg(name: string, fallback?: number): number | undefined {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a number, got "${raw}"`);
  return value;
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

export function line(label: string, value: unknown): void {
  console.log(`${label.padEnd(16)}${String(value)}`);
}

export function amount(value: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(value, decimals)} ${symbol}`;
}

export function header(account?: Address): void {
  line("network", `${network()} (chain ${chain().id})`);
  line("rpc", rpcEndpoint());
  if (account) line("wallet", account);
}

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

/**
 * A reader of its own for sending and waiting.
 *
 * The app's shared client turns transport retries off and retries per call
 * instead. A script waiting on a receipt has no such wrapper around it, and a
 * single throttled poll should not abandon a transaction that is about to land.
 */
let reader: PublicClient | null = null;

export function scriptReader(): PublicClient {
  reader ??= createPublicClient({
    chain: chain(),
    transport: http(rpcEndpoint(), { retryCount: 4, retryDelay: 500, timeout: 20_000 }),
  }) as PublicClient;
  return reader;
}

/**
 * The script's signing account.
 *
 * `JUNO_SCRIPT_PRIVATE_KEY`, else `.juno/launcher.key`, else a fresh key
 * written there (mode 600) so repeated runs reuse one funded wallet. A fresh
 * key has no MON, so its address is printed with the faucet to fund it from.
 * The private key itself is never printed.
 */
export function scriptAccount(): PrivateKeyAccount {
  const existing = readScriptKey();
  if (existing) return privateKeyToAccount(existing);

  const key = generatePrivateKey();
  mkdirSync(path.dirname(KEY_PATH), { recursive: true });
  writeFileSync(KEY_PATH, `${key}\n`, { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);
  const account = privateKeyToAccount(key);
  console.log(`Generated a new script key at ${KEY_PATH} (gitignored; keep it private).`);
  console.log(`Its address is ${account.address}.`);
  if (!isMainnet()) console.log(`Fund it with testnet MON at ${FAUCET_URL} and re-run.\n`);
  return account;
}

/** Stop with a funding hint when the wallet cannot pay for what comes next. */
export async function requireBalance(account: Address, needed: bigint, what: string): Promise<bigint> {
  const balance = await scriptReader().getBalance({ address: account });
  line("balance", amount(balance, 18, "MON"));
  if (balance < needed) {
    const hint = isMainnet() ? "Fund it and re-run." : `Get testnet MON at ${FAUCET_URL} and re-run.`;
    throw new Error(
      `${account} has ${formatUnits(balance, 18)} MON; ${what} needs about ${formatUnits(needed, 18)} MON. ${hint}`,
    );
  }
  return balance;
}

/** `--token 0x…`, or `--latest` for the launchpad's newest token. */
export async function resolveToken(): Promise<Address> {
  const raw = arg("token");
  if (raw) {
    if (!isAddress(raw)) throw new Error(`--token ${raw} is not an address`);
    return getAddress(raw);
  }
  if (flag("latest")) {
    const launchpad = launchpadAddress();
    if (!launchpad) throw new Error("NEXT_PUBLIC_JUNO_LAUNCHPAD is not set.");
    const count = await scriptReader().readContract({
      address: launchpad,
      abi: junoLaunchpadAbi,
      functionName: "tokenCount",
    });
    if (count === 0n) throw new Error("The launchpad has no tokens yet. Launch one with npm run juno:launch.");
    return scriptReader().readContract({
      address: launchpad,
      abi: junoLaunchpadAbi,
      functionName: "tokens",
      args: [count - 1n],
    });
  }
  throw new Error("Pass --token <address>, or --latest for the newest launch.");
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

/**
 * Headroom over a gas estimate. Monad charges for the gas *limit*, not the gas
 * used, so this is the ~7.5% Monad recommends rather than a wallet's habitual
 * 30–50% — the same margin `lib/juno/tx.ts` gives the app's transactions.
 */
const GAS_MARGIN_BPS = 750n;

export async function estimate(account: Address, call: ContractCall): Promise<bigint> {
  const gas = await scriptReader().estimateGas({ account, to: call.to, data: call.data, value: call.value });
  // `extraGas` is gas the estimate cannot see, e.g. a v2 pair's first swap
  // after graduation (see V2_SWAP_HEADROOM); the API adds it the same way.
  return gas + (gas * GAS_MARGIN_BPS) / 10_000n + (call.extraGas ?? 0n);
}

/**
 * Sign and send one call, wait for its receipt, and fail loudly on a revert.
 *
 * The estimate runs first, so a call the chain would refuse is explained
 * before anything is signed.
 */
export async function send(account: PrivateKeyAccount, call: ContractCall): Promise<TransactionReceipt> {
  const client = scriptReader();
  let gas: bigint;
  try {
    gas = await estimate(account.address, call);
  } catch (error) {
    throw new Error(`${call.label}: ${describeError(error)}`);
  }
  const fees = await client.estimateFeesPerGas();

  const wallet = createWalletClient({
    account,
    chain: chain(),
    transport: http(rpcEndpoint(), { retryCount: 2, retryDelay: 500 }),
  });

  console.log(`\n${call.label}…`);
  const hash = await wallet
    .sendTransaction({
      account,
      chain: chain(),
      to: call.to,
      data: call.data,
      value: call.value,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    })
    .catch((error: unknown) => {
      throw new Error(`${call.label}: ${describeError(error)}`);
    });
  line("sent", links.tx(hash));

  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") {
    throw new Error(`${call.label} reverted in block ${receipt.blockNumber}: ${links.tx(hash)}`);
  }
  line("confirmed", `block ${receipt.blockNumber}, gas ${receipt.gasUsed} of ${gas}`);
  return receipt;
}

/** The launchpad's events in a receipt, decoded. */
export function launchpadEvents(receipt: TransactionReceipt, launchpad: Address) {
  return parseEventLogs({
    abi: junoLaunchpadAbi,
    logs: receipt.logs.filter((log) => getAddress(log.address) === launchpad),
  });
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

type DecodedError = { errorName: string; args?: readonly unknown[] };

/** Revert data or an already-decoded error buried somewhere in a viem error. */
function customError(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  // A holder rather than two `let`s: assignments inside the walk callback are
  // invisible to TypeScript's narrowing.
  const found: { raw?: Hex; decoded?: DecodedError } = {};
  error.walk((cause) => {
    const data = (cause as { data?: unknown }).data;
    if (data && typeof data === "object" && "errorName" in data) {
      found.decoded = data as DecodedError;
      return true;
    }
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
      found.raw = data as Hex;
      return true;
    }
    return false;
  });
  if (!found.decoded && found.raw) {
    for (const abi of [junoLaunchpadAbi, junoTokenAbi] as const) {
      try {
        found.decoded = decodeErrorResult({ abi, data: found.raw }) as DecodedError;
        break;
      } catch {
        // Not this contract's error; try the next.
      }
    }
  }
  if (!found.decoded) return null;
  const { errorName, args } = found.decoded;
  return args?.length ? `${errorName}(${args.map(String).join(", ")})` : errorName;
}

/**
 * A failure as a script user needs it: the contract's own error name when
 * there is one, a funding hint when that is the problem, the node's words
 * otherwise.
 */
export function describeError(error: unknown): string {
  const named = customError(error);
  const text =
    error instanceof BaseError
      ? [error.shortMessage, error.details].filter(Boolean).join(" — ")
      : error instanceof Error
        ? error.message
        : String(error);
  if (named) return `the launchpad refused with ${named}`;
  // Monad's RPC says "insufficient balance"; geth-style nodes "insufficient funds".
  if (/insufficient (funds|balance)|exceeds (the )?balance/i.test(text)) {
    return `not enough MON for this and its gas.${isMainnet() ? "" : ` Get testnet MON at ${FAUCET_URL}.`}`;
  }
  if (/returned no data/i.test(text)) {
    return `${text} Is there a contract at that address on ${network()}? Check NEXT_PUBLIC_JUNO_LAUNCHPAD and --token.`;
  }
  return text;
}

/** Run a script's `main`, printing a one-line failure instead of a stack. */
export function run(main: () => Promise<void>): void {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      // viem's own messages run to a screenful; its short message is the sentence.
      const message = error instanceof BaseError || !(error instanceof Error) ? describeError(error) : error.message;
      console.error(`\nError: ${message}`);
      process.exit(1);
    });
}
