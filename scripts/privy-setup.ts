/**
 * One-time setup for autopilot's Privy signer (lib/juno/autopilot.ts).
 *
 *   npx tsx scripts/privy-setup.ts --dry-run   # make a key, print the request, send nothing
 *   dotenv -e .env.local -- npx tsx scripts/privy-setup.ts
 *
 * Makes a P-256 authorization key, registers its public half with Privy as a
 * key quorum (the signer people add to their wallets), and writes the three
 * values the server needs to `.juno/privy-autopilot.env` (gitignored, mode
 * 600). Put them in the server's environment, never in git:
 *
 *   PRIVY_SIGNER_ID          the key quorum id (public; the app adds it as a signer)
 *   PRIVY_AUTHORIZATION_KEY  the private key (secret; signs every autopilot request)
 *   PRIVY_SPONSOR_GAS=1      once gas sponsorship is on for Monad testnet in the Privy dashboard
 *
 * Needs NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrivyClient } from "@privy-io/node";

import { generateAuthorizationKey } from "../lib/juno/privy-keys";

const OUT = path.resolve(process.cwd(), ".juno/privy-autopilot.env");

async function main() {
  const key = generateAuthorizationKey();
  const request = { display_name: "Juno autopilot", public_keys: [key.publicKey], authorization_threshold: 1 };

  if (process.argv.includes("--dry-run")) {
    console.log("POST https://api.privy.io/v1/key_quorums");
    console.log(JSON.stringify(request, null, 2));
    console.log("\nDry run: nothing sent, no key kept.");
    return;
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET (e.g. in .env.local) first.");

  const quorum = await new PrivyClient({ appId, appSecret }).keyQuorums().create(request);
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    [
      `# Juno autopilot signer for Privy app ${appId}, made ${new Date().toISOString()}`,
      `PRIVY_SIGNER_ID=${quorum.id}`,
      `PRIVY_AUTHORIZATION_KEY=${key.privateKey}`,
      "# PRIVY_SPONSOR_GAS=1   # after enabling gas sponsorship for Monad testnet in the dashboard",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log(`Key quorum ${quorum.id} registered with Privy.`);
  console.log(`PRIVY_SIGNER_ID and PRIVY_AUTHORIZATION_KEY are in ${path.relative(process.cwd(), OUT)}. Add them to the server's environment.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
