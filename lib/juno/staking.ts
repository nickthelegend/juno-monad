import "server-only";

import { Staking } from "@monad-crypto/viem";
import { createPublicClient, getAddress, http, isAddress, type PublicClient } from "viem";

import { chain, isMainnet } from "./network";

/**
 * Monad's native staking, read live from Monad's own network.
 *
 * The staking precompile at 0x…1000 has no code on a local fork (anvil
 * clones contracts, not precompiles), so this always reads Monad itself:
 * testnet unless the deployment is on mainnet. Read-only. Delegating sends a
 * transaction and waits, like every other testnet transaction, for the go.
 */
const WEI = 10n ** 18n;

export type ValidatorView = {
  id: number;
  authAddress: string;
  stakeMon: number;
  /** Percent, from the precompile's 1e18-scaled rate. */
  commissionPct: number;
  unclaimedRewardsMon: number;
};

function mon(wei: bigint): number {
  return Number(wei / 10n ** 12n) / 1e6;
}

/** One `getValidator` answer, as the screen reads it. */
export function describeValidator(id: bigint | number, tuple: readonly unknown[]): ValidatorView {
  const [authAddress, , stake, , commission, unclaimed] = tuple as [string, bigint, bigint, bigint, bigint, bigint];
  return {
    id: Number(id),
    authAddress,
    stakeMon: mon(stake),
    commissionPct: (Number((commission * 10_000n) / WEI) / 100),
    unclaimedRewardsMon: mon(unclaimed),
  };
}

let client: PublicClient | null = null;
function network(): PublicClient {
  const url = process.env.MONAD_NETWORK_RPC_URL?.trim() || (isMainnet() ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz");
  client ??= createPublicClient({ chain: chain(), transport: http(url, { timeout: 10_000 }) }) as PublicClient;
  return client;
}

export type StakingSnapshot = {
  network: "monad-testnet" | "monad";
  epoch: number;
  /** In the delay period a stake change takes effect two epochs on, otherwise one. */
  inEpochDelayPeriod: boolean;
  effectiveEpoch: number;
  proposer: ValidatorView;
  /** Validators in the consensus set, counted page by page. */
  validators: number | null;
  /** Validators this wallet has delegated to, when one was asked about. */
  delegations: number[] | null;
  at: string;
};

let cached: { at: number; value: Omit<StakingSnapshot, "delegations"> } | null = null;
const TTL_MS = 15_000;

export async function stakingSnapshot(wallet?: string | null, now = Date.now()): Promise<StakingSnapshot> {
  const c = network();
  if (!cached || now - cached.at > TTL_MS) {
    const [epochAnswer, proposerAnswer] = await Promise.all([Staking.getEpoch(c, {}), Staking.getProposerValId(c, {})]);
    const [epoch, inDelay] = epochAnswer as unknown as readonly [bigint, boolean];
    const proposerId = proposerAnswer as unknown as bigint;
    const proposer = describeValidator(proposerId, (await Staking.getValidator(c, { args: [proposerId] })) as readonly unknown[]);
    let validators: number | null = 0;
    try {
      // Pages of 100 from a start index; bounded so a misbehaving answer cannot loop.
      let start = 0;
      for (let page = 0; page < 10; page++) {
        const [done, next, ids] = (await Staking.getConsensusValidatorSet(c, { args: [start] })) as [boolean, number, readonly bigint[]];
        validators += ids.length;
        if (done) break;
        start = Number(next);
      }
    } catch {
      validators = null;
    }
    cached = {
      at: now,
      value: {
        network: isMainnet() ? "monad" : "monad-testnet",
        epoch: Number(epoch),
        inEpochDelayPeriod: inDelay,
        effectiveEpoch: Number(epoch) + (inDelay ? 2 : 1),
        proposer,
        validators,
        at: new Date(now).toISOString(),
      },
    };
  }
  let delegations: number[] | null = null;
  if (wallet && isAddress(wallet)) {
    try {
      const [, , ids] = (await Staking.getDelegations(c, { args: [getAddress(wallet), 0n] })) as [boolean, bigint, readonly bigint[]];
      delegations = ids.map(Number);
    } catch {
      delegations = null;
    }
  }
  return { ...cached.value, delegations };
}
