/**
 * Let a release APK reach an API on the developer's own machine, and nothing
 * else over plain HTTP.
 *
 * Android blocks cleartext HTTP in release builds. That is right for every
 * real host, but it leaves an APK unable to reach `http://10.0.2.2:3100` — the
 * emulator's name for the host machine, where the local API and fork run — so
 * a release build could only ever be tried against a deployed HTTPS API. This
 * adds a network security config that permits cleartext to the emulator's
 * host alias and to loopback only; every other host stays HTTPS-only.
 *
 * Debug builds keep plain HTTP everywhere, as the template gives them: Metro
 * on a LAN address has to reach a phone. A network security config overrides
 * the debug manifest's `usesCleartextTraffic`, so the debug source sets get a
 * permissive copy of the same resource, which overlays the release one.
 * `android/` is generated, so the rule lives here and survives every prebuild.
 */
const fs = require("node:fs");
const path = require("node:path");
const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");

const LOCAL_HOSTS = ["10.0.2.2", "localhost", "127.0.0.1"];

const CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
${LOCAL_HOSTS.map((host) => `    <domain includeSubdomains="false">${host}</domain>`).join("\n")}
  </domain-config>
</network-security-config>
`;

const DEBUG_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

function write(root, sourceSet, contents) {
  const dir = path.join(root, `app/src/${sourceSet}/res/xml`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "network_security_config.xml"), contents);
}

module.exports = function withLocalCleartext(config) {
  config = withDangerousMod(config, [
    "android",
    async (mod) => {
      const root = mod.modRequest.platformProjectRoot;
      write(root, "main", CONFIG);
      for (const sourceSet of ["debug", "debugOptimized"]) write(root, sourceSet, DEBUG_CONFIG);
      return mod;
    },
  ]);
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    if (application) application.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return mod;
  });
};
