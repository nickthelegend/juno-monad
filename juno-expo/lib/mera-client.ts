import type { WebAuthnClient } from "@category-labs/mera";

/**
 * The web build: Mera's default client, which calls `navigator.credentials`.
 * iOS and Android resolve `mera-client.native.ts` instead.
 */
export const webAuthnClient: WebAuthnClient | undefined = undefined;

export function passkeysSupported(): boolean {
  return typeof globalThis.PublicKeyCredential !== "undefined" && Boolean(globalThis.navigator?.credentials);
}
