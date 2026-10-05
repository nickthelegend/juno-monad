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
