/**
 * Fallback types for the Expo app's dependencies, for the root project only.
 *
 * A few unit tests import pure helpers from `juno-expo/lib/` (candles, format,
 * markets), and `markets.ts` imports `juno-expo/lib/api.ts`, which imports
 * Expo packages. The root typecheck — `tsc -p .` and `next build` — follows
 * those imports.
 *
 * Where `juno-expo/node_modules` is installed, the real types resolve and these
 * patterns are never consulted: TypeScript only falls back to a wildcard
 * ambient module when normal resolution fails. Where it is not — the CI app
 * job installs the root package alone — they stop an Expo dependency from
 * failing the web app's typecheck. The Expo app's own CI job type-checks those
 * imports against the real packages.
 */
declare module "expo-*";
declare module "@expo/*";
declare module "react-native*";
declare module "@react-native*";
