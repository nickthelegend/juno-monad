/**
 * The app's entry: what has to be evaluated before React renders, then
 * Expo Router's own entry.
 *
 * Expo Router loads the root layout, and everything it imports, while React is
 * rendering. Privy's web SDK defines its styled-components at the top of its
 * modules, and styled-components warns about every component created during a
 * render — twenty-seven warnings on each page load. `lib/preload` evaluates
 * the SDK first on the web; on iOS and Android it is empty.
 */
import "./lib/preload";
import "expo-router/entry";
