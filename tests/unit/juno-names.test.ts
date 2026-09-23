import { beforeEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * The Mongo collection behind names, replaced by a recorder.
 *
 * Every refusal below must happen before the database is touched, so by
 * default reaching it throws — a refusal that ever gets that far fails loudly
 * instead of silently writing. The success cases switch it to a collection
 * that records what would have been written.
 */
const store = vi.hoisted(() => ({
  reachable: false,
  duplicate: false,
  writes: [] as Array<{ filter: unknown; update: unknown; options: unknown }>,
}));

vi.mock("../../lib/juno/social", () => ({
  db: async () => {
    if (!store.reachable) throw new Error("reached the database");
    return {
      collection: () => ({
        createIndex: async () => "ok",
        updateOne: async (filter: unknown, update: unknown, options: unknown) => {
          if (store.duplicate) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
          store.writes.push({ filter, update, options });
          return { acknowledged: true };
        },
      }),
    };
  },
}));

import { claimName, nameMessage } from "../../lib/juno/profiles";
import { networkKey } from "../../lib/juno/network";

/**
 * Claiming a name.
 *
 * A name is the thing people recognise someone by, so the only way to set one
 * is to sign for it with the wallet's key — an EIP-191 `personal_sign`, what
 * any Ethereum wallet shows as "Sign message". These are the ways a claim must
 * be refused, each a way someone could take a name that is not theirs, and the
 * one way it must succeed.
 */
async function signed(account: PrivateKeyAccount, name: string, issuedAt = new Date().toISOString()) {
  const wallet = account.address;
  const signature = await account.signMessage({ message: nameMessage(wallet, name, issuedAt) });
  return { wallet: wallet as string, name, issuedAt, signature: signature as string };
}

const fresh = () => privateKeyToAccount(generatePrivateKey());

beforeEach(() => {
  store.reachable = false;
  store.duplicate = false;
  store.writes = [];
});

describe("nameMessage", () => {
  it("is the exact text the app shows in the wallet prompt", () => {
    expect(nameMessage("0xabc", "alice", "2026-09-24T00:00:00.000Z")).toBe(
      "Juno name: alice\nWallet: 0xabc\nIssued: 2026-09-24T00:00:00.000Z",
    );
  });
});

describe("claimName: refusals", () => {
  it("refuses a signature from a different wallet", async () => {
    const owner = fresh();
    const thief = fresh();
    const forged = { ...(await signed(thief, "alice")), wallet: owner.address };
    await expect(claimName(forged)).rejects.toThrow(/does not match this wallet/);
  });

  it("refuses a signature over a different name", async () => {
    const claim = { ...(await signed(fresh(), "alice")), name: "bob" };
    await expect(claimName(claim)).rejects.toThrow(/does not match this wallet/);
  });

  it("refuses a signature over a different timestamp", async () => {
    // The timestamp is part of what was signed. Moving it to dodge the expiry
    // check must break the signature.
    const original = await signed(fresh(), "alice", new Date(Date.now() - 60_000).toISOString());
    await expect(claimName({ ...original, issuedAt: new Date().toISOString() })).rejects.toThrow(
      /does not match this wallet/,
    );
  });

  it("refuses a request signed too long ago, so a signature cannot be replayed", async () => {
    const stale = await signed(fresh(), "alice", new Date(Date.now() - 10 * 60_000).toISOString());
    await expect(claimName(stale)).rejects.toThrow(/expired/);
  });

  it("refuses a request dated in the future, and one with no usable date", async () => {
    const future = await signed(fresh(), "alice", new Date(Date.now() + 10 * 60_000).toISOString());
    await expect(claimName(future)).rejects.toThrow(/expired/);
    await expect(claimName({ ...(await signed(fresh(), "alice")), issuedAt: "yesterday" })).rejects.toThrow(/expired/);
  });

  it("refuses names outside 3–20 letters, digits and underscores", async () => {
    const owner = fresh();
    for (const name of ["ab", "a".repeat(21), "has space", "emoji🙂", "dash-name"]) {
      await expect(claimName(await signed(owner, name))).rejects.toThrow(/3–20 characters/);
    }
  });

  it("refuses reserved names, case-insensitively", async () => {
    const owner = fresh();
    await expect(claimName(await signed(owner, "Juno"))).rejects.toThrow(/reserved/);
    await expect(claimName(await signed(owner, "MONAD"))).rejects.toThrow(/reserved/);
  });

  it("refuses a malformed wallet", async () => {
    const claim = await signed(fresh(), "alice");
    await expect(claimName({ ...claim, wallet: "nope" })).rejects.toThrow(/not an address/);
    // A Solana-shaped address is not a Monad one.
    await expect(
      claimName({ ...claim, wallet: "9CHr5g24EdzUKg9GZFUvEuAvHAjZGCsF1Z3zVPudWYoE" }),
    ).rejects.toThrow(/not an address/);
  });

  it("refuses a malformed signature", async () => {
    const claim = await signed(fresh(), "alice");
    // Not hex at all.
    await expect(claimName({ ...claim, signature: "0OIl" })).rejects.toThrow(/not valid/);
    // Hex, but not a signature — it must be refused, not thrown as a 500.
    await expect(claimName({ ...claim, signature: "0x1234" })).rejects.toThrow(/does not match this wallet/);
  });
});

describe("claimName: success", () => {
  it("stores a correctly signed claim against the checksummed wallet", async () => {
    store.reachable = true;
    const owner = fresh();
    const result = await claimName(await signed(owner, "Alice_01"));

    expect(result).toEqual({ wallet: owner.address, name: "Alice_01" });
    expect(store.writes).toHaveLength(1);
    const [write] = store.writes;
    expect(write.filter).toEqual({ network: networkKey(), wallet: owner.address });
    // Display case is kept; uniqueness is on the lowercase key.
    expect(write.update).toMatchObject({ $set: { name: "Alice_01", nameKey: "alice_01" } });
    expect(write.options).toEqual({ upsert: true });
  });

  it("accepts a lowercase wallet the phone signed in good faith", async () => {
    // The message is rebuilt from the wallet exactly as submitted, and the
    // signer is compared against its checksummed form.
    store.reachable = true;
    const owner = fresh();
    const wallet = owner.address.toLowerCase();
    const issuedAt = new Date().toISOString();
    const signature = await owner.signMessage({ message: nameMessage(wallet, "lower", issuedAt) });

    const result = await claimName({ wallet, name: "lower", issuedAt, signature });
    expect(result.wallet).toBe(owner.address);
  });

  it("says a name is taken when the unique index refuses it", async () => {
    store.reachable = true;
    store.duplicate = true;
    await expect(claimName(await signed(fresh(), "taken"))).rejects.toThrow(/taken/);
  });
});
