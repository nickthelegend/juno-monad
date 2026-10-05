/**
 * Associate the web app's domain with the phone apps, so a passkey made on
 * the web is the same Mera account in the app (lib/mera-client.native.ts).
 *
 *   APPLE_TEAM_ID=ABCDE12345 ANDROID_CERT_SHA256=AA:BB:… node scripts/passkey-domain.mjs [dist]
 *
 * Writes, into the web export:
 *   .well-known/apple-app-site-association  — webcredentials for <team>.<bundle id>
 *   .well-known/assetlinks.json             — get_login_creds for <package> signed with <cert>
 *
 * The iOS side also needs `webcredentials:<domain>` in the entitlements
 * (app.json `ios.associatedDomains`), which a build can only carry when the
 * Apple team has Associated Domains on for the App ID. Each file is written
 * only when its input is set: a placeholder association is worse than none.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "dist", ".well-known");
const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")).expo;
const team = process.env.APPLE_TEAM_ID?.trim();
const certs = (process.env.ANDROID_CERT_SHA256 ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
const written = [];

if (team) {
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error("APPLE_TEAM_ID is ten letters and digits");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, "apple-app-site-association"),
    JSON.stringify({ webcredentials: { apps: [`${team}.${app.ios.bundleIdentifier}`] } }, null, 2),
  );
  written.push("apple-app-site-association");
}

if (certs.length) {
  for (const cert of certs) {
    if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(cert)) throw new Error(`${cert} is not a SHA-256 fingerprint (AA:BB:… 32 bytes)`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, "assetlinks.json"),
    JSON.stringify(
      [
        {
          relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
          target: { namespace: "android_app", package_name: app.android.package, sha256_cert_fingerprints: certs },
        },
      ],
      null,
      2,
    ),
  );
  written.push("assetlinks.json");
}

console.log(written.length ? `passkey domain: wrote ${written.join(", ")}` : "passkey domain: APPLE_TEAM_ID / ANDROID_CERT_SHA256 not set, nothing written");
