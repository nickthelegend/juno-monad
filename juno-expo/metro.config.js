const { getDefaultConfig } = require("expo/metro-config");

/**
 * Metro, with the package-exports fixes Privy's native SDK needs.
 *
 * On iOS and Android, Metro resolves package `exports` with the
 * `react-native` and `require` conditions, and for these packages that picks
 * a build that cannot run in Hermes: `jose` resolves to its Node build (which
 * imports `util` and `zlib`), and `isows` and `zustand@4` export shapes Metro
 * mis-resolves. The browser build of `jose` and the classic `main` field of
 * the other two work — the same fixes juno-arbitrum ships its Privy build
 * with. The web bundle resolves as it always has.
 */
const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== "web") {
    if (moduleName === "jose") {
      return context.resolveRequest({ ...context, unstable_conditionNames: ["browser"] }, moduleName, platform);
    }
    if (moduleName === "isows" || moduleName.startsWith("zustand")) {
      return context.resolveRequest({ ...context, unstable_enablePackageExports: false }, moduleName, platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
