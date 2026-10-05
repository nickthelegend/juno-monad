import "server-only";

import { getAddress, isAddress, isHex, parseEther, type Address, type Hex } from "viem";

import { CallerError } from "./api";
import { USDC } from "./launchpad";
import { chainId, launchpadAddress, networkKey, swapRouterAddress } from "./network";
import { privy, privyConfigured } from "./privy";
import { privySendInput } from "./privy-keys";
import { evaluatePolicy, tradingPolicy, type TradingPolicy } from "./privy-policy";
import { plans, recordContribution } from "./social-graph";
import { db } from "./social";
import { buildSwap, explainFailure, settleSent, type SubmitResult } from "./tx";

/**
 * Autopilot: Juno sends trades for a Privy wallet, inside a Privy policy, and
 * Privy pays the gas.
 *
 * Plans (recurring buys) used to stop at "due": executing a buy for someone
 * needs authority over their wallet, and Juno had none. Privy's session
 * signers provide it. The person adds Juno's server key (a Privy key quorum,
 * `PRIVY_SIGNER_ID`) to their embedded wallet as a signer, limited by a
 * policy written for that wallet alone (`privy-policy.ts`): Juno trades that
 * pay out to them, a MON cap per trade, an expiry. From then on:
 *
 * - **Plans run themselves.** `runDuePlans` buys each due plan's coin through
 *   Privy's wallet API while the person is offline.
 * - **Gas is sponsored.** Each request carries `sponsor: true`, so Privy's
 *   native gas sponsorship (EIP-7702 and a paymaster, available on Monad
 *   testnet) pays for it. A Privy wallet with no MON can still trade.
 *
 * Every request is checked against the policy here first, so a refusal comes
 * back as a sentence. Privy's policy engine checks it again with the
 * server's key, and that check is the one that counts.
 *
 * It is on when `PRIVY_APP_SECRET`, `PRIVY_SIGNER_ID` and
 * `PRIVY_AUTHORIZATION_KEY` are set (see `scripts/privy-setup.ts`);
 * `PRIVY_SPONSOR_GAS=1` adds `sponsor: true` once gas sponsorship is enabled
 * for Monad testnet in the Privy dashboard. Without them it is `off`, and the
 * app says autopilot is not set up on this server. There is no stand-in:
 * Privy's wallet API is the only thing that sends for a wallet.
 */

export type AutopilotMode = "privy" | "off";

export function autopilotMode(): AutopilotMode {
  return privyConfigured() && process.env.PRIVY_SIGNER_ID?.trim() && process.env.PRIVY_AUTHORIZATION_KEY?.trim() ? "privy" : "off";
}

/** MON a single autopilot trade may carry. */
function maxPerTradeMon(): number {
  const raw = Number(process.env.JUNO_AUTOPILOT_MAX_MON ?? "5");
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

const DAYS = 30;

export type AutopilotConfig = {
  mode: AutopilotMode;
  /** The key quorum the app adds as a signer; null outside `privy` mode. */
  signerId: string | null;
  sponsor: boolean;
  maxPerTradeMon: number;
  days: number;
};

/** What `/api/juno/config` tells the app. Nothing here is a secret. */
export function autopilotConfig(): AutopilotConfig {
  const mode = autopilotMode();
  return {
    mode,
    signerId: mode === "privy" ? process.env.PRIVY_SIGNER_ID!.trim() : null,
    sponsor: mode === "privy" && process.env.PRIVY_SPONSOR_GAS === "1",
    maxPerTradeMon: maxPerTradeMon(),
    days: DAYS,
  };
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

type EnrolmentDoc = {
  network: string;
  wallet: Address;
  mode: "privy";
  /** pending: the policy exists, the app has not added the signer yet. */
  status: "pending" | "active" | "stopped";
  privyUserId: string | null;
  walletId: string | null;
  policyId: string | null;
  policy: TradingPolicy;
  expiresAt: Date;
  createdAt: Date;
  activatedAt: Date | null;
  stoppedAt: Date | null;
  /** A lease: one sender per wallet at a time, so two never race for a nonce. */
  lockedUntil?: Date;
};

export type RunDoc = {
  network: string;
  wallet: Address;
  kind: "plan" | "trade";
  planId: string | null;
  /**
   * `<plan>@<epoch>` while a plan buy is in flight or done, where the epoch is
   * the plan's last fill (or its creation): unique, so a due plan is bought
   * once however many runners see it. Cleared when the buy fails, so a later
   * pass can try again.
   */
  claim: string | null;
  label: string;
  hash: Hex | null;
  via: "privy";
  sponsored: boolean;
  error: string | null;
  at: Date;
};

async function enrolments() {
  const collection = (await db()).collection<EnrolmentDoc>("autopilot");
  await collection.createIndex({ network: 1, wallet: 1 }, { unique: true }).catch(() => undefined);
  return collection;
}

async function runs() {
  const collection = (await db()).collection<RunDoc>("autopilot_runs");
  await collection.createIndex({ network: 1, wallet: 1, at: -1 }).catch(() => undefined);
  await collection
    .createIndex({ network: 1, claim: 1 }, { unique: true, partialFilterExpression: { claim: { $type: "string" } } })
    .catch(() => undefined);
  return collection;
}

/* ------------------------------------------------------------------ */
/* Who is asking                                                       */
/* ------------------------------------------------------------------ */

/** The person's live Privy session: the server verifies it and checks the wallet is theirs. */
export type AutopilotProof = { accessToken?: string };

function requireWallet(raw: string): Address {
  if (!isAddress(raw)) throw new CallerError("wallet is not an address");
  return getAddress(raw);
}

function requireMode(): "privy" {
  if (autopilotMode() === "off") throw new CallerError("Autopilot is not set up on this server.", 503);
  return "privy";
}

/** The Privy user behind a session, and the embedded wallet of theirs this is. */
async function privyOwner(wallet: Address, accessToken: string | undefined): Promise<{ userId: string; walletId: string }> {
  if (!accessToken) throw new CallerError("Sign in with Privy first.", 401);
  let userId: string;
  try {
    ({ user_id: userId } = await privy().utils().auth().verifyAccessToken(accessToken));
  } catch {
    throw new CallerError("That Privy session is not valid. Sign in again.", 401);
  }
  const user = await privy().users()._get(userId);
  const embedded = user.linked_accounts.find(
    (account) =>
      account.type === "wallet" &&
      "connector_type" in account &&
      account.connector_type === "embedded" &&
      "address" in account &&
      isAddress(account.address) &&
      getAddress(account.address) === wallet,
  );
  const walletId = embedded && "id" in embedded ? embedded.id : null;
  if (!walletId) throw new CallerError("Autopilot works with your Privy embedded wallet, and this is not it.", 403);
  return { userId, walletId };
}

/* ------------------------------------------------------------------ */
/* Turning it on and off                                               */
/* ------------------------------------------------------------------ */

export type AutopilotStatus = {
  mode: AutopilotMode;
  status: "off" | "pending" | "active" | "expired";
  expiresAt: string | null;
  policyId: string | null;
  signerId: string | null;
  sponsor: boolean;
  maxPerTradeMon: number;
  /** The policy's rules, by name: what Juno may do. */
  allows: string[];
  runs: Array<Omit<RunDoc, "network" | "at"> & { at: string }>;
};

export async function autopilotStatus(walletInput: string): Promise<AutopilotStatus> {
  const wallet = requireWallet(walletInput);
  const config = autopilotConfig();
  const doc = config.mode === "off" ? null : await (await enrolments()).findOne({ network: networkKey(), wallet });
  const recent = doc
    ? await (await runs()).find({ network: networkKey(), wallet }, { projection: { _id: 0, network: 0 } }).sort({ at: -1 }).limit(10).toArray()
    : [];
  const live = doc && doc.status !== "stopped" && doc.mode === config.mode ? doc : null;
  return {
    mode: config.mode,
    status: !live ? "off" : live.expiresAt.getTime() <= Date.now() ? "expired" : live.status === "pending" ? "pending" : "active",
    expiresAt: live?.expiresAt.toISOString() ?? null,
    policyId: live?.policyId ?? null,
    signerId: config.signerId,
    sponsor: config.sponsor,
    maxPerTradeMon: config.maxPerTradeMon,
    allows: live?.policy.rules.map((rule) => rule.name) ?? [],
    runs: recent.map((run) => ({ ...run, at: run.at.toISOString() })),
  };
}

/**
 * Step one of turning autopilot on: write this wallet's policy in Privy and
 * answer with what the app adds to the wallet: `{signerId, policyId}`.
 */
export async function startAutopilot(input: { wallet: string } & AutopilotProof): Promise<AutopilotStatus> {
  const mode = requireMode();
  const wallet = requireWallet(input.wallet);
  const launchpad = launchpadAddress();
  if (!launchpad) throw new CallerError("This server has no launchpad.", 503);
  const owner = await privyOwner(wallet, input.accessToken);

  const expiresAt = new Date(Date.now() + DAYS * 86_400_000);
  const policy = tradingPolicy({
    wallet,
    chainId: chainId(),
    launchpad,
    router: swapRouterAddress(),
    usdc: USDC.address,
    maxValueWei: parseEther(String(maxPerTradeMon())),
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
  });
  const policyId = (await privy().policies().create(policy as never)).id;

  const now = new Date();
  await (await enrolments()).updateOne(
    { network: networkKey(), wallet },
    {
      $set: {
        mode,
        status: "pending",
        privyUserId: owner.userId,
        walletId: owner.walletId,
        policyId,
        policy,
        expiresAt,
        createdAt: now,
        activatedAt: null,
        stoppedAt: null,
      },
    },
    { upsert: true },
  );
  return autopilotStatus(wallet);
}

/**
 * Step two: the app has added the signer; check with Privy that the wallet
 * really carries Juno's key under this policy, then start acting on it.
 */
export async function confirmAutopilot(input: { wallet: string } & AutopilotProof): Promise<AutopilotStatus> {
  requireMode();
  const wallet = requireWallet(input.wallet);
  const collection = await enrolments();
  const doc = await collection.findOne({ network: networkKey(), wallet });
  if (!doc || doc.status === "stopped") throw new CallerError("Turn autopilot on first.", 409);
  if (doc.status === "active") return autopilotStatus(wallet);

  const owner = await privyOwner(wallet, input.accessToken);
  const held = await privy().wallets().get(owner.walletId);
  const signers = (held.additional_signers ?? []) as Array<{ signer_id: string; override_policy_ids?: string[] }>;
  const ours = signers.find((signer) => signer.signer_id === autopilotConfig().signerId);
  if (!ours) throw new CallerError("Your wallet does not list Juno as a signer yet. Try again.", 409);
  if (doc.policyId && !(ours.override_policy_ids ?? []).includes(doc.policyId)) {
    throw new CallerError("Juno's signer is on your wallet without autopilot's policy. Turn autopilot off and on again.", 409);
  }
  await collection.updateOne({ network: networkKey(), wallet }, { $set: { status: "active", activatedAt: new Date() } });
  return autopilotStatus(wallet);
}

/** Stop acting for this wallet. The app removes the signer from the wallet itself. */
export async function stopAutopilot(input: { wallet: string } & AutopilotProof): Promise<AutopilotStatus> {
  requireMode();
  const wallet = requireWallet(input.wallet);
  await privyOwner(wallet, input.accessToken);
  const collection = await enrolments();
  const doc = await collection.findOne({ network: networkKey(), wallet });
  await collection.updateOne({ network: networkKey(), wallet }, { $set: { status: "stopped", stoppedAt: new Date() } });
  if (doc?.policyId) await privy().policies().delete(doc.policyId, {}).catch(() => undefined);
  return autopilotStatus(wallet);
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

export type AutopilotCall = { to: Address; data: Hex; value: bigint; label: string };

export type AutopilotResult = SubmitResult & { via: "privy"; sponsored: boolean };

async function activeEnrolment(wallet: Address): Promise<EnrolmentDoc> {
  const mode = requireMode();
  const doc = await (await enrolments()).findOne({ network: networkKey(), wallet });
  if (!doc || doc.status !== "active" || doc.mode !== mode) throw new CallerError("Autopilot is off for this wallet.", 409);
  if (doc.expiresAt.getTime() <= Date.now()) throw new CallerError("Autopilot has expired for this wallet. Turn it on again.", 409);
  return doc;
}

/** Send one call as the wallet: policy first, then Privy's wallet API, then the receipt. */
async function sendAs(doc: EnrolmentDoc, call: AutopilotCall): Promise<AutopilotResult> {
  const verdict = evaluatePolicy(doc.policy, { chainId: chainId(), to: call.to, value: call.value, data: call.data });
  if (!verdict.allowed) throw new CallerError(verdict.reason, 403);
  const started = performance.now();

  const sponsored = autopilotConfig().sponsor;
  const sent = await privy()
    .wallets()
    .ethereum()
    .sendTransaction(
      doc.walletId!,
      privySendInput(call, { chainId: chainId(), sponsor: sponsored, authorizationKey: process.env.PRIVY_AUTHORIZATION_KEY!.trim() }),
    );
  const result = await settleSent(sent.hash as Hex, doc.wallet, started);
  return { ...result, via: "privy", sponsored };
}

/** A failure in words: the caller's sentence, or the chain's reason without the request dump. */
function reasonOf(error: unknown): string {
  return error instanceof CallerError ? error.message : explainFailure(error);
}

/**
 * Run `work` holding the wallet's lease. Waits up to `waitMs` for another
 * sender (a runner, or the person's own trade) to finish; null if it did not.
 */
async function withWallet<T>(wallet: Address, waitMs: number, work: () => Promise<T>): Promise<T | null> {
  const collection = await enrolments();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const now = new Date();
    const held = await collection.findOneAndUpdate(
      { network: networkKey(), wallet, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lt: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + 180_000) } },
    );
    if (held) break;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  try {
    return await work();
  } finally {
    await collection.updateOne({ network: networkKey(), wallet }, { $set: { lockedUntil: new Date(0) } });
  }
}

/**
 * Trades the person asked for, sent by autopilot so Privy pays the gas. The
 * app sends the steps the server built for it; each must pass the policy,
 * and the Privy session proves the person is here asking.
 */
export async function sendForWallet(
  input: { wallet: string; steps: Array<{ to: string; data: string; value: string; label: string }> } & AutopilotProof,
): Promise<AutopilotResult[]> {
  const wallet = requireWallet(input.wallet);
  const doc = await activeEnrolment(wallet);
  const owner = await privyOwner(wallet, input.accessToken);
  if (owner.userId !== doc.privyUserId) throw new CallerError("That Privy session is not this wallet's.", 403);
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 4) throw new CallerError("steps: one to four transactions");
  const calls = input.steps.map((step): AutopilotCall => {
    if (!isAddress(step.to) || !isHex(step.data) || !isHex(step.value)) throw new CallerError("A step is not a transaction");
    return { to: getAddress(step.to), data: step.data, value: BigInt(step.value), label: String(step.label ?? "Trade") };
  });
  const results = await withWallet(wallet, 30_000, async () => {
    const landed: AutopilotResult[] = [];
    for (const call of calls) {
      try {
        const result = await sendAs(doc, call);
        landed.push(result);
        await (await runs()).insertOne({
          network: networkKey(), wallet, kind: "trade", planId: null, claim: null, label: call.label,
          hash: result.hash, via: result.via, sponsored: result.sponsored, error: null, at: new Date(),
        });
      } catch (error) {
        if (landed.length === 0) throw error;
        throw new CallerError(`${landed.length} of ${calls.length} went through; then: ${reasonOf(error)}`, 422);
      }
    }
    return landed;
  });
  if (!results) throw new CallerError("Autopilot is busy with this wallet. Try again in a moment.", 409);
  return results;
}

export type PlanRunReport = { wallet: Address; planId: string; label: string; hash: Hex | null; error: string | null; sponsored: boolean };

/** After a failed buy, a plan waits this long before the next try. */
const RETRY_AFTER_MS = 30 * 60_000;

/**
 * Buy every due plan of every wallet on autopilot.
 *
 * Each wallet is handled under its lease, one transaction at a time, so a
 * second runner skips it rather than racing it for a nonce. Each due plan is
 * claimed (`<plan>@<last fill>`, unique) before anything is sent, so it is
 * bought once. A plan's contribution moves only when its buy confirms. A
 * failed buy frees the claim and is tried again after `RETRY_AFTER_MS`.
 */
export async function runDuePlans(): Promise<PlanRunReport[]> {
  if (autopilotMode() === "off") return [];
  const active = await (await enrolments())
    .find({ network: networkKey(), status: "active", mode: "privy", expiresAt: { $gt: new Date() } })
    .toArray();
  const reports: PlanRunReport[] = [];
  for (const doc of active) {
    await withWallet(doc.wallet, 0, async () => {
      const log = await runs();
      for (const plan of (await plans(doc.wallet)).filter((p) => p.due)) {
        const failed = await log.findOne({ network: networkKey(), planId: plan.id, error: { $ne: null }, at: { $gt: new Date(Date.now() - RETRY_AFTER_MS) } });
        if (failed) continue;
        const claim = `${plan.id}@${plan.lastFilledAt ?? plan.createdAt}`;
        const base = { network: networkKey(), wallet: doc.wallet, kind: "plan" as const, planId: plan.id };
        let id;
        try {
          ({ insertedId: id } = await log.insertOne({ ...base, claim, label: "Buying", hash: null, via: "privy", sponsored: false, error: null, at: new Date() }));
        } catch {
          continue; // Bought already for this due time.
        }
        let label = "Plan buy";
        try {
          const built = await buildSwap({ token: plan.token, side: "buy", amountIn: plan.amount, owner: doc.wallet });
          let last: AutopilotResult | null = null;
          for (const step of built.steps) {
            label = step.label;
            last = await sendAs(doc, { to: step.request.to, data: step.request.data, value: BigInt(step.request.value), label: step.label });
          }
          await recordContribution(plan.id, plan.amount);
          const venue = built.venue === "curve" ? "on its curve" : built.venue === "kuru" ? "on Kuru" : "on Uniswap v2";
          label = `Plan: bought with ${plan.amount} ${built.quoteSymbol} ${venue}`;
          await log.updateOne({ _id: id }, { $set: { label, hash: last!.hash, via: last!.via, sponsored: last!.sponsored, at: new Date() } });
          reports.push({ wallet: doc.wallet, planId: plan.id, label, hash: last!.hash, error: null, sponsored: last!.sponsored });
        } catch (error) {
          const message = reasonOf(error);
          await log.updateOne({ _id: id }, { $set: { claim: null, label: `Plan: ${label.toLowerCase()} failed`, error: message, at: new Date() } });
          reports.push({ wallet: doc.wallet, planId: plan.id, label, hash: null, error: message, sponsored: false });
        }
      }
    });
  }
  return reports;
}
