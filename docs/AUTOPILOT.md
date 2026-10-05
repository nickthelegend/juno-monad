# Autopilot: Privy session signers, policies and gas sponsorship

Juno uses Privy for more than login. Someone signed in with Privy can turn on
**autopilot** (Profile → Plans):

1. Juno's server writes a **Privy policy for that one wallet**
   (`POST /v1/policies`). It allows only Juno trades:
   - buys and sells on Juno's curves whose `recipient` is the wallet;
   - buys and sells on graduated coins' Uniswap v2 pairs through Juno's router,
     whose `to` is the wallet;
   - a USDC `approve` whose spender is the launchpad or the router.

   Each rule also pins the chain (10143), caps the MON per transaction
   (`JUNO_AUTOPILOT_MAX_MON`, default 5) and ends after 30 days
   (`system.current_unix_timestamp`).
2. The app adds Juno's key quorum to the embedded wallet as a **session
   signer** under that policy (`useSigners().addSigners`, on web and native).
   The server then reads the wallet back from Privy and checks that the signer
   is there with the policy.
3. From then on:
   - **Plans run themselves.** Recurring buys used to stop at "due now". The
     runner (`POST /api/juno/autopilot/run`, on the same cron as the log tail)
     buys each due plan through Privy's wallet API, signed with the server's
     authorization key, while the person is offline.
   - **Gas is sponsored.** Every request carries `sponsor: true` (Privy's
     native gas sponsorship, EIP-7702 plus a paymaster, supported on Monad
     testnet). Once sponsorship is enabled, a Privy wallet's own trades go the
     same way, so it can trade with no MON.

Turning it off stops the server and takes the signer off the wallet.

| Part | File |
|---|---|
| The policy, and a local copy of Privy's rule check | `lib/juno/privy-policy.ts` |
| Enrolment, sending through Privy, the plan runner | `lib/juno/autopilot.ts` |
| Routes | `app/api/juno/autopilot/{route,send/route,run/route}.ts` |
| P-256 authorization key, Privy RPC input | `lib/juno/privy-keys.ts` |
| One-time signer setup | `scripts/privy-setup.ts` |
| App: the card, sponsored sending | `juno-expo/components/Autopilot.tsx`, `juno-expo/lib/autopilot-relay.ts`, `juno-expo/lib/wallet.tsx` (`signAndSubmit`) |
| Privy bridges: `addSigner`, `removeSigners`, access token | `juno-expo/lib/privy.web.tsx`, `juno-expo/lib/privy.native.tsx` |

## Safety

- The policy holds even if Juno's server misbehaves: Privy refuses a transfer,
  an approval to anyone else, a trade paying out elsewhere, another chain,
  more MON than the cap, or anything after expiry. Juno checks the same rules
  first (`evaluatePolicy`) so a refusal comes back as a sentence.
- Each due plan is claimed once (`<plan>@<last fill>`, a unique index), and
  each wallet has a lease, so two runners never buy the same plan twice or race
  for a nonce. A failed buy frees its claim and is retried after 30 minutes.
- The authorization key never leaves the server. Requests carry a P-256
  signature over the canonical request instead.
- A sponsored trade the person asks for needs their live Privy session (access
  token), and the session must belong to the enrolled Privy user.

## On or off

| State | When | What happens |
|---|---|---|
| On | `PRIVY_APP_SECRET`, `PRIVY_SIGNER_ID` and `PRIVY_AUTHORIZATION_KEY` are set | Everything above. `PRIVY_SPONSOR_GAS=1` adds `sponsor: true`. |
| Off | Any of them missing | The Plans tab says autopilot is not set up on this server; plans work as before (due, then signed by the person). |

There is no stand-in mode: only Privy's wallet API sends for a wallet. (An
earlier fork-only fixture mode, in which anvil impersonated the wallet, was
removed on 6 Oct.)

## What the owner sets up (keys only)

1. `dotenv -e .env.local -- npx tsx scripts/privy-setup.ts` with
   `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET`. This registers a key
   quorum and writes `PRIVY_SIGNER_ID` and `PRIVY_AUTHORIZATION_KEY` to
   `.juno/privy-autopilot.env`. Put them in the API's environment.
2. Privy dashboard: enable **gas sponsorship** for Monad testnet, then set
   `PRIVY_SPONSOR_GAS=1`.
3. Privy dashboard: allow session signers for the app, if it asks.
4. `JUNO_CRON_SECRET` on the API and the cron that calls `/autopilot/run`.

## Proof

- **`tests/unit/juno-autopilot.test.ts`** (6 tests). It runs the real
  `lib/juno/autopilot.ts` against test doubles for Privy's client, Mongo,
  the plans table and the trade builder. It checks that:
  - autopilot is off without a signer;
  - enrolment writes the wallet's policy in Privy, and confirmation waits
    for Juno's signer under that policy;
  - a session from another Privy user is refused;
  - two runners at once buy each due plan exactly once, through Privy's
    `eth_sendTransaction` with `sponsor: true` and Juno's authorization key,
    and record the contribution;
  - a step that pays out to another address is refused before Privy is asked;
  - after stop, sends are refused.
- **`tests/unit/juno-privy-policy.test.ts`** (9 tests): the policy and the
  local evaluator.
- **`tests/unit/juno-privy-autopilot.test.ts`** (2 tests): the two Privy calls
  made through Privy's own SDK against a stub of its API. They check the
  `/v1/policies` body, the `/v1/wallets/{id}/rpc` body with `sponsor: true`,
  and that the `privy-authorization-signature` header verifies against the
  key quorum's public key.
- **Live: awaiting testnet go.** Privy's wallet API broadcasts to Monad
  testnet itself, so a live run needs the signer set up (below) and the
  testnet hold lifted.
