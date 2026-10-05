# Mera passkeys in the iOS and Android apps

The web app's Mera account (`juno-expo/lib/mera.ts`) runs on iOS and Android
through **Mera's own React Native WebAuthn client**
(`@category-labs/mera/react-native-webauthn-client`). That client is built on
`react-native-passkey` 3.6.1: ASAuthorization on iOS, which returns PRF from
iOS 18, and Credential Manager on Android. The rest of the code is shared:
- PRF → BIP-39 → `m/44'/60'/0'/0/0`;
- 15-minute signing sessions, the countdown and *End session*;
- the "same passkey, same account" check.

| Piece | Where |
|---|---|
| Platform split | `lib/mera-client.native.ts` (Mera's RN client, `Passkey.isSupported()`) and `lib/mera-client.ts` (web: Mera's default `navigator.credentials` client) |
| Relying party on a phone | `PASSKEY_RP_ID`, the web app's domain (`juno-monad-app.vercel.app`; override `EXPO_PUBLIC_PASSKEY_RP_ID`). One passkey is the same account on the web and on the phone. |
| Account record | the iOS Keychain / Android Keystore (`expo-secure-store`) instead of `localStorage`. It holds only the address and credential id. |
| iOS entitlement | `app.json` → `ios.associatedDomains: ["webcredentials:juno-monad-app.vercel.app"]` |
| Domain files | `juno-expo/scripts/passkey-domain.mjs` writes `.well-known/apple-app-site-association` and `.well-known/assetlinks.json` into the web export (run by `npm run export:web`). `vercel.web.json` serves the first as JSON. |
| Errors | iOS without PRF says it needs iOS 18; Android says to use Google Password Manager; a failed ceremony names the domain association. |
| Sealed drafts | Web only. Mera's secret vaults call `navigator.credentials` directly, so the composer hides them on a phone, and `sealSecret` refuses rather than trying. |

## Tested

- `tests/unit/juno-expo-mera-native.test.ts`, with the platform set to iOS:
  - creating an account calls Mera with rp `juno-monad-app.vercel.app` and
    Mera's RN client;
  - only `{address, credentialId}` goes to the keychain;
  - after *End session*, the same passkey brings back the same address;
  - sealed drafts are refused.

  The passkey prompt is mocked; it needs a device.
- The web build is unchanged. `react-native-passkey` is not in the web bundle,
  and `.juno/mera-e2e.mjs` against the fork build passes with 0 console or
  network problems:
  - create with one passkey use;
  - signing in the session, 0 prompts;
  - End session, then 1 prompt;
  - cleared storage, then the same account.

## What the owner provides

A passkey ceremony in the app needs the domain to vouch for the app, and
that needs the owner's signing identities:

1. **iOS:** an Apple Developer team with *Associated Domains* enabled for
   `app.launch.junomonad`. Build with that team, then export the web app with
   `APPLE_TEAM_ID=<team id>` so the AASA names `<team>.app.launch.junomonad`.
2. **Android:** the release signing certificate's SHA-256 fingerprint
   (`keytool -list -v -keystore <release.keystore>`). Export with
   `ANDROID_CERT_SHA256=<AA:BB:…>`. Add the debug keystore's fingerprint too,
   comma-separated, to test a debug build.
3. Redeploy the web app so `https://juno-monad-app.vercel.app/.well-known/…`
   serves both files. Then rebuild the apps (`expo prebuild`, which picks up
   `react-native-passkey` and the entitlement).

Not run here: a native passkey ceremony. A simulator or emulator build
cannot complete one without the team id and certificate above, and the files
served from the domain.
