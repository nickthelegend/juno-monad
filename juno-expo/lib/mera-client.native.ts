import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import { Passkey } from "react-native-passkey";

/**
 * Mera's passkey ceremonies on iOS and Android: Mera's own React Native
 * WebAuthn client over `react-native-passkey` (ASAuthorization on iOS, which
 * returns PRF from iOS 18; Credential Manager on Android).
 *
 * The relying party is a web domain the app is associated with:
 * `webcredentials:` in the iOS entitlements (app.json `associatedDomains`)
 * and Digital Asset Links on Android, both pointing back at the app from
 * files served at `https://<rp>/.well-known/` (`scripts/passkey-domain.mjs`).
 * With the same rp as the web app, one passkey is the same Mera account on
 * the web and on the phone.
 */
export const webAuthnClient = reactNativeWebAuthnClient;

export function passkeysSupported(): boolean {
  try {
    return Passkey.isSupported();
  } catch {
    return false;
  }
}

/** The native client does not capture the new passkey's public key yet: passkeys on chain are web-only for now. */
export function takeCreatedPublicKey(): Uint8Array | null {
  return null;
}

export async function assertPasskey(_input: { rpId: string; credentialId: Uint8Array; challenge: Uint8Array }): Promise<never> {
  throw new Error("Proving a passkey on Monad works in the web app for now.");
}
