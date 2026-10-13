# How Juno uses Agora: AUSD is the margin, one tap away

*Juno · Monad Metropolis, Track 01 · live at https://juno-monad-app.vercel.app (Monad testnet)*

Juno is a social feed where every post is a market. A photo or a reel launches its own coin on a bonding curve on
Monad in one transaction. Fans buy it straight from the feed, and the creator earns the trading fees. When a curve
fills, the coin graduates into its own Kuru order book (or a Uniswap v2 pair, if the creator chose that at
launch).

## The problem Agora solves: a dollar to trade with

Juno's Perps tab trades on Perpl, and Perpl takes one kind of collateral: AUSD, Agora's dollar on Monad. A new
user arrives with an empty wallet, or with a passkey account made a few seconds ago. Before they can open a
position they need AUSD, and on testnet that AUSD only comes from Agora's faucet contract. The faucet has no page
of its own and enforces rules a user can't see.

So Agora gives Juno two things:
1. **the unit of account for leverage**: every Perpl balance, margin figure and P&L in Juno is in AUSD;
2. **onboarding**: an in-app button that brings 10,000 test AUSD to the wallet in one signature.

Together with Mera (the passkey account) and Perpl (the venue), this is the flow Agora's mobile bounty asks for:
sign in with a passkey, hold AUSD, trade perps, all in one app.

## How it works

### 1. The faucet call, checked before signing

[`lib/juno/perpl.ts`](../lib/juno/perpl.ts) talks to Agora's AUSD faucet on Monad testnet, at
`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`. The faucet's rules are public views, so the server reads all of them
before building the call:

```ts
const [drip, every, last, cap, held, stock] = await Promise.all([
  read<bigint>("faucetDripAmount"),
  read<bigint>("maxDripFrequency"),
  read<bigint>("lastDripTimestamp"),
  read<bigint>("maxAmountToOwn"),
  withRetry(() => client.readContract({ address: ausd, abi: junoTokenAbi, functionName: "balanceOf", args: [owner] })),
  withRetry(() => client.readContract({ address: ausd, abi: junoTokenAbi, functionName: "balanceOf", args: [faucet] })),
]);
```

If the faucet is empty, the wallet is already at the cap, or the global cooldown has not passed, the user gets a
sentence ("Agora's faucet sends once every 60 seconds across everyone. Try again in N seconds") instead of a
reverted transaction. Otherwise the server returns one call to sign, `requestFunds(owner)`. The route is
`POST /api/juno/perps/faucet` ([`app/api/juno/perps/faucet/route.ts`](../app/api/juno/perps/faucet/route.ts)).

### 2. The button appears only when it is needed

In [`Perps.tsx`](../juno-expo/components/Perps.tsx), the faucet is offered only on testnet and only when the
wallet holds less AUSD than Perpl's minimum to open an account:

```tsx
{account.ausdFaucet && account.walletAusd < account.minimumOpen ? (
  {/* … */}
  <Button
    label={busy === "faucet" ? "Getting AUSD…" : "Get 10,000 test AUSD"}
```

The account card also shows where the money is: AUSD free on Perpl, AUSD held by orders, and AUSD in the wallet.

### 3. From AUSD to a position

The deposit path approves AUSD for Perpl's exchange if the allowance is short, then calls `createAccount` (the
first time) or `depositCollateral`. Opens and closes are Perpl `execOrder`s, and withdraw returns AUSD to the
wallet. Each step is a server-built transaction signed by the same wallet: a Mera passkey account, a device key or
a Privy embedded wallet.

### 4. The same account on web and phone

The app is one Expo codebase ([`juno-expo/`](../juno-expo/)) for web, iOS and Android. On a phone, Mera's
passkey ceremonies go through Mera's React Native client
([`mera-client.native.ts`](../juno-expo/lib/mera-client.native.ts)). The relying party is the web app's domain,
`juno-monad-app.vercel.app`, so one passkey is meant to be the same account, holding the same AUSD, in the browser
and in the native app ([MOBILE-PASSKEYS.md](MOBILE-PASSKEYS.md)).

## Engineering notes

- **The cooldown is global.** The faucet allows one drip per `maxDripFrequency` seconds across all callers, not
  per wallet. During a demo, two people tapping at once would make one of them fail. Reading
  `lastDripTimestamp` first turns that into a countdown.
- **Top-up cap.** The faucet only sends while the recipient holds less than `maxAmountToOwn`. The server checks
  `held + drip > cap` and says so.
- **AUSD has 6 decimals**, unlike MON and Juno's coins (18). Every Perpl and AUSD amount goes through one
  constant, `CNS = 1_000_000`.
- **Mainnet is different.** Mainnet AUSD has its own address (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`) and no
  faucet. `ausdFaucetAddress()` returns null there, and the button is not shown.
- **The faucet was once dry.** On 29 Sep it was empty, which blocked the perps test. The `stock < drip` check
  exists for this reason.

## The value it brought

- **Time to first trade.** With a passkey account and the AUSD button, a judge goes from no wallet to an open
  Perpl position without leaving the app or finding a faucet site. The first transaction after creating a passkey
  account, the AUSD faucet, landed in 1.6 s with no further prompts in the 5 Oct hosted test.
- **A stable unit for risk.** Margin, liquidation distance, funding per day and P&L are all in dollars, so the
  Risk view reads plainly.
- **The bounty's three parts in one place**: Mera for the account, AUSD for the balance, Perpl for the trade.

## Live proof (Monad testnet)

- 10,000 AUSD from Agora's faucet to a fresh wallet, built by Juno's hosted API:
  [0x6bd741fb…dd84](https://testnet.monadvision.com/tx/0x6bd741fb729021b61fc37a41eb3e7d3188a8bf787e4a3258f857ff12ae92dd84)
- That AUSD then became Perpl margin: deposit
  [0x7889568e…1564](https://testnet.monadvision.com/tx/0x7889568e2bb65cd1b0ac01b6338bb8d6407c95c254165a61573e037e38cc1564),
  2x BTC long
  [0x3f81ae5a…864b](https://testnet.monadvision.com/tx/0x3f81ae5afaf036f4b38b1e94f4b9bccc10fad402db8b735afa613088b011864b),
  close
  [0x429d63aa…a890](https://testnet.monadvision.com/tx/0x429d63aac297846255bbb09d3751de8943afa5e094a3171dbafcc2f5c7cca890).

These 13 Oct transactions were sent from one fresh wallet by a script, through the same hosted API path the app
uses. On 5 Oct the full flow passed in the hosted app's UI: a Mera passkey account, "Get 10,000 test AUSD", a
Perpl account, a 2x long, close and withdraw ([E2E-HOSTED.md](E2E-HOSTED.md)).

## Honest limits

- **The live mobile app is the web build.** It works in a phone browser at the URL above, and that is where the
  Mera → AUSD → Perpl flow has run. The iOS and Android apps build from the same Expo source, but there is no App
  Store or Play Store listing.
- **Native passkeys have not completed a ceremony.** That needs the owner's Apple team id (Associated Domains)
  and Android release certificate, served from the web domain. The native code is unit-tested with the passkey
  prompt mocked.
- AUSD here is test AUSD from a faucet. Juno does not mint, redeem or bridge AUSD.
