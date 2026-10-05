import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

/**
 * Mera on a phone (lib/mera.ts with Platform.OS = "ios"): the passkey
 * ceremonies use Mera's React Native client against the web app's domain,
 * the account's address and credential id go to the keychain, and sealed
 * drafts (browser-only vaults) are refused rather than attempted.
 *
 * The ceremonies themselves are mocked: a passkey prompt needs a device. Runs
 * where `juno-expo/node_modules` is installed; the root-only CI job skips it.
 */

const installed = existsSync(path.resolve(__dirname, "../../juno-expo/node_modules/@category-labs/mera"));

const { keychain, nativeClient, prf } = vi.hoisted(() => ({
  keychain: new Map<string, string>(),
  nativeClient: { createCredential: () => undefined, getCredential: () => undefined },
  prf: new Uint8Array(32).fill(7),
}));
// The app's own copy of Mera, as lib/mera.ts resolves it. Both paths are
// variables so the root typecheck, which runs without the app's packages,
// does not follow them into the app.
const MERA: string = "../../juno-expo/node_modules/@category-labs/mera/dist/index.js";
const APP_MERA: string = "../../juno-expo/lib/mera";
type AppMera = {
  createMeraAccount: () => Promise<string>;
  unlockMeraAccount: (expected?: string) => Promise<string>;
  endMeraSession: () => void;
  meraAvailable: () => boolean;
  sealSecret: (secret: Uint8Array) => Promise<string>;
  sealedDraftsAvailable: () => boolean;
  PASSKEY_RP_ID: string;
};

// The app's own copies, as lib/mera.ts resolves them.
vi.mock("../../juno-expo/node_modules/react-native/index.js", () => ({ Platform: { OS: "ios" } }));
vi.mock("../../juno-expo/node_modules/expo-secure-store/build/SecureStore.js", () => ({
  getItem: (key: string) => keychain.get(key) ?? null,
  setItem: (key: string, value: string) => void keychain.set(key, value),
  deleteItemAsync: async (key: string) => void keychain.delete(key),
}));
vi.mock("../../juno-expo/lib/mera-client", () => ({ webAuthnClient: nativeClient, passkeysSupported: () => true }));
vi.mock("../../juno-expo/node_modules/@category-labs/mera/dist/index.js", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../juno-expo/node_modules/@category-labs/mera/dist/index.js");
  return {
    ...actual,
    createPasskeyWithPrfOutput: vi.fn(async () => ({ credentialId: "cred-1", prfSalt: new Uint8Array(32), prfOutput: prf.slice() })),
    getPasskeyPrfOutput: vi.fn(async () => ({ credentialId: "cred-1", prfOutput: prf.slice() })),
  };
});

describe.skipIf(!installed)("Mera on a phone", () => {
  it("creates the account through Mera's React Native client, for the web app's domain", async () => {
    const mera = (await import(MERA)) as { createPasskeyWithPrfOutput: unknown; getPasskeyPrfOutput: unknown };
    const { createMeraAccount, meraAvailable, PASSKEY_RP_ID, unlockMeraAccount, endMeraSession } = (await import(APP_MERA)) as AppMera;
    expect(meraAvailable()).toBe(true);

    const address = await createMeraAccount();
    expect(PASSKEY_RP_ID).toBe("juno-monad-app.vercel.app");
    expect(mera.createPasskeyWithPrfOutput).toHaveBeenCalledWith(
      expect.objectContaining({ rp: { id: "juno-monad-app.vercel.app", name: "Juno" }, webAuthnClient: nativeClient }),
    );
    // The keychain holds the address and credential id, nothing secret.
    const stored = JSON.parse([...keychain.values()][0]);
    expect(stored).toEqual({ address, credentialId: "cred-1" });

    // The same passkey brings back the same account, through the same client.
    endMeraSession();
    expect(await unlockMeraAccount(address)).toBe(address);
    expect(mera.getPasskeyPrfOutput).toHaveBeenCalledWith({ rpId: "juno-monad-app.vercel.app", webAuthnClient: nativeClient });
  });

  it("refuses sealed drafts on a phone instead of calling the browser's credentials API", async () => {
    const { sealSecret, sealedDraftsAvailable } = (await import(APP_MERA)) as AppMera;
    expect(sealedDraftsAvailable()).toBe(false);
    await expect(sealSecret(new Uint8Array([1]))).rejects.toThrow("Sealed drafts open in the web app for now.");
  });
});
