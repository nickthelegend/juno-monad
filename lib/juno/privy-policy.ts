import { decodeFunctionData, formatEther, getAddress, isAddress, toHex, type Abi, type AbiFunction, type Address, type Hex } from "viem";

import { junoLaunchpadAbi, junoSwapRouterAbi, junoTokenAbi } from "./abi";

/**
 * The Privy policy behind Juno's autopilot, and a local copy of Privy's rule
 * check.
 *
 * Someone who turns autopilot on adds Juno's server key to their Privy wallet
 * as a session signer, under a policy written for that wallet alone. Privy's
 * policy engine then refuses anything the server asks for outside it. The
 * policy allows exactly Juno trades for this wallet:
 *
 * - buys and sells on Juno's bonding curves (`buy`, `buyExactOut`, `sell`)
 *   whose `recipient` is this wallet,
 * - buys and sells on graduated coins' Uniswap v2 pairs through Juno's router
 *   (`buyWithNative`, `sellForNative`, `swapExactTokens`) whose `to` is this
 *   wallet,
 * - a USDC `approve` whose spender is the launchpad or the router,
 *
 * each only on this chain, with at most `maxValueWei` of MON attached, and
 * only until `expiresAt`. A transfer, an approval to anyone else, or a trade
 * that pays out to another address matches no rule, and Privy denies by
 * default.
 *
 * `evaluatePolicy` applies the same rules here. Before a request goes to
 * Privy, it turns a refusal into a sentence. In fixture mode, with no Privy
 * keys, it is the only check.
 */

export type EthereumTransactionCondition = {
  field_source: "ethereum_transaction";
  field: "to" | "value" | "chain_id";
  operator: "eq" | "in" | "lte" | "lt" | "gte" | "gt";
  value: string | string[];
};

export type EthereumCalldataCondition = {
  field_source: "ethereum_calldata";
  /** `<function>.<argument>`, decoded with `abi`. */
  field: string;
  abi: AbiFunction[];
  operator: "eq" | "in";
  value: string | string[];
};

export type SystemCondition = {
  field_source: "system";
  field: "current_unix_timestamp";
  operator: "lte" | "lt" | "gte" | "gt";
  value: string;
};

export type PolicyCondition = EthereumTransactionCondition | EthereumCalldataCondition | SystemCondition;

export type PolicyRule = {
  name: string;
  method: "eth_sendTransaction";
  action: "ALLOW" | "DENY";
  conditions: PolicyCondition[];
};

/** The body of Privy's `POST /v1/policies`. */
export type TradingPolicy = {
  version: "1.0";
  name: string;
  chain_type: "ethereum";
  rules: PolicyRule[];
};

export type PolicyInput = {
  wallet: Address;
  chainId: number;
  launchpad: Address;
  router: Address | null;
  usdc: Address | null;
  maxValueWei: bigint;
  /** Unix seconds. */
  expiresAt: number;
};

function fragment(abi: Abi, name: string): AbiFunction {
  const found = abi.find((item): item is AbiFunction => item.type === "function" && item.name === name);
  if (!found) throw new Error(`No ${name} in the ABI`);
  return found;
}

const CURVE = [
  { fn: "buy", recipient: "recipient", label: "Buy on a Juno curve" },
  { fn: "buyExactOut", recipient: "recipient", label: "Buy an exact amount on a Juno curve" },
  { fn: "sell", recipient: "recipient", label: "Sell on a Juno curve" },
] as const;

const PAIR = [
  { fn: "buyWithNative", recipient: "to", label: "Buy with MON on a graduated coin's pair" },
  { fn: "sellForNative", recipient: "to", label: "Sell for MON on a graduated coin's pair" },
  { fn: "swapExactTokens", recipient: "to", label: "Swap USDC on a graduated coin's pair" },
] as const;

export function tradingPolicy(input: PolicyInput): TradingPolicy {
  const wallet = getAddress(input.wallet);
  const base = (to: Address): PolicyCondition[] => [
    { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(input.chainId) },
    { field_source: "ethereum_transaction", field: "to", operator: "eq", value: getAddress(to) },
    { field_source: "ethereum_transaction", field: "value", operator: "lte", value: toHex(input.maxValueWei) },
    { field_source: "system", field: "current_unix_timestamp", operator: "lte", value: String(input.expiresAt) },
  ];
  const rules: PolicyRule[] = CURVE.map(({ fn, recipient, label }) => ({
    name: label,
    method: "eth_sendTransaction",
    action: "ALLOW",
    conditions: [
      ...base(input.launchpad),
      { field_source: "ethereum_calldata", field: `${fn}.${recipient}`, abi: [fragment(junoLaunchpadAbi, fn)], operator: "eq", value: wallet },
    ],
  }));
  if (input.router) {
    for (const { fn, recipient, label } of PAIR) {
      rules.push({
        name: label,
        method: "eth_sendTransaction",
        action: "ALLOW",
        conditions: [
          ...base(input.router),
          { field_source: "ethereum_calldata", field: `${fn}.${recipient}`, abi: [fragment(junoSwapRouterAbi, fn)], operator: "eq", value: wallet },
        ],
      });
    }
  }
  if (input.usdc) {
    const spenders = [input.launchpad, input.router].filter((a): a is Address => a !== null).map((a) => getAddress(a));
    rules.push({
      name: "Let Juno's launchpad or router spend USDC",
      method: "eth_sendTransaction",
      action: "ALLOW",
      conditions: [
        ...base(input.usdc).map((c) => (c.field === "value" ? { ...c, operator: "eq" as const, value: "0x0" } : c)),
        { field_source: "ethereum_calldata", field: "approve.spender", abi: [fragment(junoTokenAbi, "approve")], operator: "in", value: spenders },
      ],
    });
  }
  return { version: "1.0", name: `Juno autopilot ${wallet.slice(0, 10)}`, chain_type: "ethereum", rules };
}

export type PolicyRequest = { chainId: number; to: Address; value: bigint; data: Hex };

export type PolicyVerdict = { allowed: true; rule: string } | { allowed: false; reason: string };

const same = (a: string, b: string) => (isAddress(a) && isAddress(b) ? getAddress(a) === getAddress(b) : a.toLowerCase() === b.toLowerCase());

function compare(actual: string | bigint, operator: string, expected: string | string[]): boolean {
  if (operator === "in") return Array.isArray(expected) && expected.some((value) => compare(actual, "eq", value));
  if (Array.isArray(expected)) return false;
  if (typeof actual === "bigint") {
    const want = BigInt(expected);
    switch (operator) {
      case "eq": return actual === want;
      case "lte": return actual <= want;
      case "lt": return actual < want;
      case "gte": return actual >= want;
      case "gt": return actual > want;
      default: return false;
    }
  }
  return operator === "eq" && same(actual, expected);
}

function holds(condition: PolicyCondition, request: PolicyRequest, nowSec: number): boolean {
  if (condition.field_source === "system") return compare(BigInt(nowSec), condition.operator, condition.value);
  if (condition.field_source === "ethereum_transaction") {
    if (condition.field === "to") return compare(request.to, condition.operator, condition.value);
    if (condition.field === "value") return compare(request.value, condition.operator, condition.value);
    return compare(BigInt(request.chainId), condition.operator, condition.value);
  }
  const [fn, arg] = condition.field.split(".");
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: condition.abi, data: request.data });
  } catch {
    return false;
  }
  if (decoded.functionName !== fn) return false;
  const index = condition.abi.find((f) => f.name === fn)?.inputs.findIndex((input) => input.name === arg) ?? -1;
  const value = index >= 0 ? (decoded.args as readonly unknown[] | undefined)?.[index] : undefined;
  if (value === undefined) return false;
  return compare(typeof value === "bigint" ? value : String(value), condition.operator, condition.value);
}

/**
 * Privy's semantics: a request is allowed when an ALLOW rule's conditions all
 * hold and no DENY rule's do; anything else is denied.
 */
export function evaluatePolicy(policy: TradingPolicy, request: PolicyRequest, nowSec = Math.floor(Date.now() / 1000)): PolicyVerdict {
  const matching = policy.rules.filter((rule) => rule.conditions.every((condition) => holds(condition, request, nowSec)));
  const denied = matching.find((rule) => rule.action === "DENY");
  if (denied) return { allowed: false, reason: `Denied by "${denied.name}".` };
  const allowed = matching.find((rule) => rule.action === "ALLOW");
  if (allowed) return { allowed: true, rule: allowed.name };
  return { allowed: false, reason: explainMiss(policy, request, nowSec) };
}

/** The nearest rule's first failing condition, in words. */
function explainMiss(policy: TradingPolicy, request: PolicyRequest, nowSec: number): string {
  const expiry = policy.rules[0]?.conditions.find((c): c is SystemCondition => c.field_source === "system");
  if (expiry && !holds(expiry, request, nowSec)) return "Autopilot has expired for this wallet. Turn it on again.";
  const forTarget = policy.rules.filter((rule) =>
    rule.conditions.some((c) => c.field_source === "ethereum_transaction" && c.field === "to" && compare(request.to, c.operator, c.value)),
  );
  if (forTarget.length === 0) return "Autopilot only sends to Juno's launchpad, its router and USDC approvals for them.";
  const cap = forTarget[0].conditions.find((c): c is EthereumTransactionCondition => c.field_source === "ethereum_transaction" && c.field === "value");
  if (cap && !holds(cap, request, nowSec)) return `That sends more MON than autopilot allows per trade (${formatEther(BigInt(cap.value as string))} MON).`;
  return "Autopilot only makes Juno trades that pay out to this wallet.";
}
