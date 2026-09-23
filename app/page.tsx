import { chainId, explorer, launchpadAddress, networkKey } from "@/lib/juno/network";

/**
 * What someone sees when they open the API's own domain.
 *
 * In production `proxy.ts` sends every page to the app, so this only renders
 * without `JUNO_APP_URL` — local development, or a judge poking at the API
 * directly. It says what this is, which network it is pointed at, and where
 * the contract lives, because those are the first three questions.
 */
export default function Home() {
  const launchpad = launchpadAddress();
  return (
    <main>
      <h1>Juno API</h1>
      <p>Every post is a market. This server builds transactions for the Juno app and reads the chain for it.</p>
      <dl>
        <dt>Network</dt>
        <dd>
          {networkKey()} (chain {chainId()})
        </dd>
        <dt>Launchpad</dt>
        <dd>
          {launchpad ? <a href={explorer.address(launchpad)}>{launchpad}</a> : "not configured — set NEXT_PUBLIC_JUNO_LAUNCHPAD"}
        </dd>
        <dt>Endpoints</dt>
        <dd>
          <a href="/api/juno/config">/api/juno/config</a>, <a href="/api/juno/coins">/api/juno/coins</a> — see docs/API.md
        </dd>
      </dl>
    </main>
  );
}
