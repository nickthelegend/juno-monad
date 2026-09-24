# Privy + Nansen for Juno (Monad Metropolis): research findings

Researched 2026-09-24. Sources: live docs (fetched as raw `.md`), npm registry, package tarballs I unpacked (`@privy-io/expo@0.74.3`, `@privy-io/js-sdk-core@0.76.2`, `@privy-io/node@0.35.0`), GitHub (Monad templates, participant repos), and keyless public probes of Nansen (`/.well-known/x402`, an unpaid `402` challenge, the public Points endpoint, `openapi.json`).

Tags: **[verified]** means I checked it in docs, code or a live probe. **[unverified]** means inferred or not testable without keys or a dashboard.

---

## TL;DR

**Privy**
- **Fits the existing seam [verified].** In the Expo SDK, the embedded wallet provider's `eth_signTransaction` forwards every field of a fully built EIP-1559 transaction to Privy's signing service: `nonce`, `chainId`, `gas`, `maxFeePerGas`, `maxPriorityFeePerGas`, `data`, `value`. It also converts bigints to hex itself. So a `PrivySignerSource` can hand Juno's server-built transaction straight to Privy, and the rest of `wallet.tsx` stays as it is.
- **Expo SDK: iOS and Android only. Web is not supported [verified].** Juno's web build would stay on the local key, or use `@privy-io/react-auth` in `*.web.tsx` files.
- **Native gas sponsorship lists "Monad Testnet" (and Monad mainnet) [verified].** In Expo it works only through a server relay. Requirements:
  - TEE execution must be enabled.
  - Monad Testnet must be selected on the Fee sponsorship dashboard page.
  - The server calls `@privy-io/node` `sendTransaction({caip2:'eip155:10143', sponsor:true, authorization_context:{user_jwts:[jwt]}})`.
  - The user's address does not change, because this route uses EIP-7702 plus a paymaster.
- **Signers + policies + stateful aggregations are exactly what Juno's "plans" lack [verified].** The comment in `app/api/juno/plans/route.ts` says as much ("needs a delegate or a session key … which this project does not have"). `useSigners().addSigners` is available in Expo.
- **Bounty text [verified from a participant's verbatim capture].** "Your project must integrate Privy beyond authentication. Using Privy only for login/authentication will not qualify." Judging: "Demo must clearly show the functionality powered by Privy. Bonus points for meaningfully integrating multiple Privy features." Single prize of $5,000.

**Nansen**
- **Monad mainnet is supported on nearly every data family [verified].** The chain value is `monad`, with data from 14 May 2025. **No testnet appears anywhere in the OpenAPI spec [verified].** Juno's testnet tokens and testnet wallets will never be in Nansen.
- **Redistribution rules kill the "Smart money is buying this reel" idea as written [verified].**
  - Prohibited from any public or customer-facing display: `address/labels` (including smart-money labels), `smart-money/holdings`, `smart-money/dex-trades`, `tgm/pnl-leaderboard`.
  - Restricted (needs approval plus "significant modification"): `smart-money/inflows`/netflow and `tgm/holders` with a smart-money filter.
  - Freely displayable: PnL and PnL-summary, balances.
  - Displayable with attribution: transactions, counterparties, related-wallets, TGM flows, who-bought-sold, flow-intelligence, token-screener.
- **Labels are expensive [verified].** 100 credits per call (premium labels 500), subscription only, not payable by x402. The free plan is 100 one-time credits, then 10 per day.
- **Nansen accepts x402 pay-per-call in USDC on Monad mainnet (`eip155:143`) [verified by live 402 probe].** Basic calls are $0.01, Smart Money/Premium calls $0.05. Privy's Node SDK has `createX402Client`. A Privy server wallet paying Nansen per call on Monad connects both sponsors and Monad.
- **Bounty text [verified].** "Build a product experience powered by Nansen data/API/MCP/CLI that goes beyond exposing raw data." All tracks, $5,000 total pool. I found no fuller card (judging criteria or deliverables) in any public repo. Also: Nansen's CEO Alex Svanevik is a **main-track judge** (from a participant's snapshot of the official judges list).

---

# Part 1: Privy

## 1.1 Packages (npm, checked 2026-09-24)

| Package | Version | Notes |
|---|---|---|
| `@privy-io/expo` | **0.74.3** (published 2026-09-21) | Peer deps: `viem` **exactly `2.56.0`** (Juno already pins 2.56.0, so they match), `permissionless ^0.2.47`, `react-native-passkeys ^0.4.0`, `@privy-io/expo-native-extensions 0.0.12`, `react-native-webview`, `react-native-qrcode-styled 0.3.3`, plus `expo-crypto`, `expo-linking`, `expo-clipboard`, `expo-application`, `expo-web-browser`, `expo-secure-store`, `expo-apple-authentication`, `react-native-svg`, `react-native-safe-area-context`. Subpath exports: `/passkey`, `/smart-wallets`, `/extended-chains`, `/ui`, `/connectors`. |
| `@privy-io/react-auth` | 3.45.0 | Web SDK. Depends on `viem 2.56.0`, `x402`, `@stripe/crypto`. Peer `permissionless ^0.2.47`. |
| `@privy-io/server-auth` | 1.32.5 | **Deprecated**: "use @privy-io/node instead". |
| `@privy-io/node` | 0.35.0 | Server SDK. Peer `viem ^2.44.2`, optional `@x402/*`. Exports `verifyAccessToken`, `verifyAuthToken`, `verifyIdentityToken`, `createViemAccount` (`@privy-io/node/viem`) and `createX402Client` (`@privy-io/node/x402`). |

Install docs (https://docs.privy.io/basics/react-native/installation):
- Requires an **Expo development build** (not Expo Go), plus polyfills `fast-text-encoding`, `react-native-get-random-values` (Juno already has it) and `@ethersproject/shims`, and a Metro `resolveRequest` override for `isows`, `zustand` and `jose`.
- The optional packages `expo-apple-authentication`, `react-native-passkeys` and `@privy-io/expo-native-extensions` can be omitted on RN 0.81+/Expo 54+. Calling the matching features then crashes.
- **"iOS and Android platform support (Web is not supported)"**.
- The app-clients doc says Expo Go can be allowed by adding `host.exp.Exponent`. Whether the SDK actually runs inside Expo Go without native modules is **[unverified]**.

## 1.2 Capabilities, and what works in Expo versus web only

Source of truth: the per-SDK feature matrix at https://docs.privy.io/basics/react-native/features, cross-checked against exports in `@privy-io/expo@0.74.3` `dist/*.d.ts` **[verified]**.

| Capability | Expo (RN) | Web (react-auth) | Notes / docs |
|---|---|---|---|
| Email / SMS OTP | ✅ `useLoginWithEmail`, `useLoginWithSMS` | ✅ | https://docs.privy.io/basics/react-native/quickstart |
| OAuth (Google, Apple, Twitter, Discord, GitHub, TikTok, LinkedIn, Spotify, Instagram…) | ✅ `useLoginWithOAuth` (needs the URL scheme registered on the app client) | ✅ | https://docs.privy.io/authentication/user-authentication/login-methods/oauth |
| Passkeys (login/signup/link) | ✅ `@privy-io/expo/passkey` (`useLoginWithPasskey`, `useSignupWithPasskey`, `useLinkWithPasskey`). Needs an iOS associated domain (`webcredentials:`), an AASA file on your domain, and Android Digital Asset Links | ✅ | https://docs.privy.io/basics/react-native/advanced/setup-passkeys |
| SIWE (log in with or link an external wallet) | ✅ `useLoginWithSiwe`, `useLinkWithSiwe`. **You produce the signature yourself**, and the SIWE domain must be allowlisted | ✅ | https://docs.privy.io/authentication/user-authentication/login-methods/wallet |
| Farcaster, custom JWT auth, guest accounts | ✅ | ✅ | features matrix |
| Embedded EVM wallet: create manually or on login | ✅ `useEmbeddedEthereumWallet().create`, `config.embedded.ethereum.createOnLogin: 'all-users' \| 'users-without-wallets' \| 'off'` | ✅ | https://docs.privy.io/basics/react-native/advanced/automatic-wallet-creation |
| Sign transaction / send transaction / `personal_sign` / `eth_signTypedData_v4` | ✅ via `wallet.getProvider()` then `provider.request(...)`. "The Expo SDK does not support built-in UIs" for these; your app draws the UI | ✅ with built-in UIs | https://docs.privy.io/wallets/using-wallets/ethereum/sign-a-transaction, …/send-a-transaction, …/sign-typed-data, …/sign-a-message |
| EIP-7702 authorization, raw hash signing | ✅ `useSign7702Authorization`, `useSignRawHash` (`/extended-chains`) | ✅ | https://docs.privy.io/wallets/using-wallets/ethereum/sign-7702-authorization |
| Custom EVM chains (Monad testnet 10143) | ✅ `supportedChains={[monadTestnet]}`. viem 2.56.0 ships `monadTestnet` (id 10_143, RPC `https://testnet-rpc.monad.xyz`) | ✅ | https://docs.privy.io/basics/react-native/advanced/configure-evm-networks ("Configure Privy with any EVM-compatible chain, like Berachain, Monad…") |
| Native smart wallets (ERC-4337: Kernel, Safe, Alchemy, Biconomy, Thirdweb, Coinbase) | ✅ `@privy-io/expo/smart-wallets` (`SmartWalletsProvider`, `useSmartWallets`). Bundler and paymaster URLs are set per chain in the dashboard. Custom chains need a chain id, bundler, paymaster and RPC | ✅ | https://docs.privy.io/wallets/using-wallets/evm-smart-wallets/overview, …/setup/configuring-dashboard, …/setup/configuring-sdk |
| **Native gas sponsorship** (`sponsor: true`) | ⚠️ **server relay only** ("All SDKs supported via server relay"). Hook-level `sponsor: true` is React-only | ✅ `useSendTransaction(..., {sponsor:true})` | https://docs.privy.io/wallets/gas-and-asset-management/gas/setup, feature matrix |
| Signers (session signers / delegated server actions) | ✅ `useSigners().addSigners/removeSigners` (`useSessionSigners` is deprecated) | ✅ | https://docs.privy.io/wallets/using-wallets/signers/add-signers |
| Card onramp (`useFundWallet`) | ✅ `@privy-io/expo/ui` `useFundWallet` (MoonPay or Coinbase only) | ✅ `useFiatOnramp` (Stripe, Meld, MoonPay, Coinbase) | https://docs.privy.io/wallets/funding/fiat-onramp |
| Crypto deposit addresses (bridge or swap into a wallet) | ✅ `useHeadlessCryptoDeposit` (experimental) | ✅ plus the deposit modal `useDepositFunds` (React only) | https://docs.privy.io/wallets/funding/crypto-deposits/overview, https://docs.privy.io/financial-flows/deposits/overview |
| Transfer / wallet-actions APIs | ✅ `useTransfer`, `useWalletActions` | ✅ | https://docs.privy.io/wallets/actions/overview |
| MFA (passkey, TOTP, SMS), policy-based MFA | ✅ `useMfa`, `useMfaEnrollment`, `useMfaEnrollmentUI` | ✅ | https://docs.privy.io/authentication/user-authentication/mfa/overview |
| **Key export** | ❌ **React only** (feature matrix; the export doc has React/Node/REST/Rust/Go/Ruby views, no RN) | ✅ | https://docs.privy.io/wallets/wallets/export |
| Global wallets (cross-app accounts) | ✅ `useLoginWithCrossApp`, `useLinkWithCrossApp`, `useSendTransactionWithCrossApp`… | ✅ | https://docs.privy.io/wallets/global-wallets/overview |
| x402 client payments | ❌ no Expo hook | ✅ `useX402Fetch` (react-auth ≥3.7.0); Node `createX402Client` | https://docs.privy.io/recipes/agent-integrations/x402 |

### The seam: how a `PrivySignerSource` maps to `Signer` [verified in code]
- In `@privy-io/js-sdk-core@0.76.2` (bundled by the Expo SDK), the Ethereum provider's `eth_signTransaction` path is `handleSignTransaction`. It copies the object, converts any `bigint` field to hex, then sends it to the embedded wallet (on-device iframe or TEE).
- On the TEE path the core serialiser `xn()` maps `from, to, nonce, chainId→chain_id, data, value, type, gas|gasLimit→gas_limit, gasPrice, maxFeePerGas, maxPriorityFeePerGas` into Privy's `eth_signTransaction` request. The result is `data.signed_transaction`.
- **`eth_signTransaction` does not populate fields; only `eth_sendTransaction` does** (`handleSendTransaction` = populate, then sign, then `eth_sendRawTransaction`). So Juno's server-built nonce, gas and fees are signed as given, and the signed bytes go to Juno's existing `/api/juno/tx/submit`.
- Juno's `toSerializable()` output uses `type: "eip1559"`. Whether Privy's `On(e.type)` accepts that string or needs `2`/`"0x2"` is **[unverified]**. Pass `type: 2` to be safe.
- The docs' RN return-value text for `eth_signTransaction` says "hash for the broadcasted transaction". That is a copy-paste error; the code returns the signed transaction.
- `signMessage` maps to `personal_sign` with params `[message, address]`.

**Structural mismatch to plan for.** `SignerSource.create()` is currently silent. A Privy source needs a **login step** (email OTP, OAuth or passkey) before a wallet exists. `connect()` therefore has to route to a sign-in screen rather than quietly minting a key. `usePrivy().isReady` already covers embedded-wallet initialisation, and the docs say not to wait on a separate flag.

### Gas sponsorship: two options for Monad testnet

**A. Privy native sponsorship (recommended) [verified docs; Monad-testnet end-to-end unverified]**
- https://docs.privy.io/wallets/gas-and-asset-management/gas/overview lists **Monad** (mainnet) and **Monad Testnet** under "App pays". It is powered by Alchemy and uses **EIP-7702 + paymaster**: "User wallets are upgraded to smart contracts … without creating a separate contract account". **The user's address stays the same.**
- Requirements:
  - **TEE execution**: "Apps **must** use TEE execution in order to use our native gas sponsorship feature".
  - The dashboard's Fee sponsorship page: turn on "Sponsor gas fees", select Monad Testnet, and add credits. "Prepaid accounts need a saved payment method to sponsor gas on **mainnets**", which suggests testnets may not need one **[unverified]**.
- Expo route:
  1. The phone gets `getAccessToken()` and sends it with the build request.
  2. The server verifies it (`@privy-io/node` `verifyAccessToken`).
  3. The server calls `privy.wallets().ethereum().sendTransaction(walletId, { caip2:'eip155:10143', sponsor:true, params:{transaction:{to,data,value}}, authorization_context:{ user_jwts:[jwt] } })`.
  - Sources: https://docs.privy.io/controls/authorization-keys/keys/create/user/request (user JWT authorisation context on Node) and the Node tab of the gas setup page. Expo also exports `useAuthorizationSignature().generateAuthorizationSignature`, which lets the client sign the request that the server relays.
- Consequences for Juno:
  - Privy, not Juno's `/submit`, broadcasts. The server gets back a transaction id or hash and waits for the receipt itself.
  - Juno's pre-assigned nonces are irrelevant on this path, because the sponsored transaction runs through a bundler.
  - "Buy with zero MON for gas" becomes demo-able: the user still needs MON for `buy`'s `value`, but not for gas. A sponsored `launch` with `firstBuy=0` needs no MON at all.
  - `tx.origin` will be the bundler. That matters only if a contract checks it.
  - Spend can be queried via `GET /v1/apps/gas_spend` (https://docs.privy.io/wallets/gas-and-asset-management/gas/gas-spend).
  - Abuse guidance: https://docs.privy.io/wallets/gas-and-asset-management/gas/security.

**B. Smart wallet (Kernel) + Pimlico paymaster (Monad's official template)**
- This is how `monad-developers/react-native-privy-pimlico-gas-sponsorship-template` works (1.3). It gives batching (approve plus buy in one userOp).
- **It changes the address.** The Kernel account becomes the holder, the creator and the fee recipient, and Juno's server would have to build *calls* for the smart account instead of signed EIP-1559 transactions for the EOA. That is a larger refactor of Juno's `from`-checked, server-built flow.
- The template also puts the Pimlico URL (with its API key) in `EXPO_PUBLIC_*`, which exposes the key in the client.

### Signers, policies and delegated actions (for Juno "plans") [verified docs]
- **Concept.** "Recurring actions: implement subscriptions, portfolio rebalancing"; "Offline actions: execute limit orders". The signer is a **key quorum**: a P-256 authorisation key your server holds. Privy never sees that key, and signing happens in the TEE.
  - https://docs.privy.io/wallets/using-wallets/signers/overview
  - https://docs.privy.io/wallets/using-wallets/signers/configure-signers
  - https://docs.privy.io/wallets/using-wallets/signers/quickstart
- **Flow.**
  1. Create an authorisation key (`openssl ecparam -name prime256v1 …`) and register a 1-of-1 key quorum on the dashboard's Authorization keys page.
  2. Create a policy (dashboard or API).
  3. The user consents in the app with `useSigners().addSigners({address, signers:[{signerId, policyIds:[policyId]}]})`.
  4. The server calls `privy.wallets().ethereum().signTransaction(walletId, {params:{transaction:{…, chain_id:10143}}, authorization_context:{authorization_private_keys:[key]}})` and submits through Juno's existing pipeline. Or it uses `sendTransaction` with `sponsor:true`.
  5. Delegated wallets show `delegated: true` in `user.linked_accounts`.
  - Sources: https://docs.privy.io/wallets/using-wallets/signers/add-signers and https://docs.privy.io/wallets/using-wallets/signers/use-signers.
- **Policy engine.** Default is DENY; any DENY wins. Methods include `eth_signTransaction`, `eth_sendTransaction`, `eth_signTypedData_v4`, `personal_sign`, `eth_sign7702Authorization`, `exportPrivateKey`. Field sources include `ethereum_transaction` (`to`, `value`, `chain_id`), `ethereum_calldata` (decoded with an ABI, e.g. `buy.recipient`) and `system.current_unix_timestamp`. Operators: `eq, neq, lt, lte, gt, gte, in, in_condition_set, contains, starts_with, ends_with`. Policies are enforced inside the TEE. Source: https://docs.privy.io/controls/policies/overview.
- **A plan policy that maps directly onto Juno's contract:**
  - `chain_id == 10143`
  - `to == JunoLaunchpad`
  - `ethereum_calldata` function `buy`, with `buy.recipient == <user wallet>` (the ABI is `buy(address token,uint256 quoteIn,uint256 minBaseOut,address recipient,uint256 deadline) payable`)
  - `value <= cap`
  - a time-bound expiry (https://docs.privy.io/controls/policies/example-policies/timebound)
- **Stateful policies (aggregations).** Rolling-window sums, e.g. "total `value` signed per 24h ≤ X". Supported only for `eth_signTransaction` and `eth_signUserOperation`, with a maximum of 10 aggregations per app. Privy calls them "disaster prevention" rather than strict real-time limits, because values are recorded after signing. Source: https://docs.privy.io/controls/policies/stateful-policies.
- **TEE again.** The policy engine and server-side access via signers both require TEE execution (https://docs.privy.io/recipes/tee-wallet-migration-guide, Expo ≥0.54.0). Whether new apps default to TEE is **[unverified]**: check Dashboard → Wallets → Advanced.
- **Legacy.** `useHeadlessDelegatedActions` / `useDelegatedActions` (`delegateWallet`) still exist in the Expo SDK. They are the pre-TEE "delegated actions" API, and migrating to TEE resets those delegations. Use signers instead.

### Funding
- **Card onramp** (`useFundWallet` in `@privy-io/expo/ui`): MoonPay or Coinbase, with `chain`, `asset` (`'native-currency' | 'USDC' | {tokenAddress}`) and `amount`, plus `moonpay.useSandbox`. Source: https://docs.privy.io/wallets/funding/fiat-onramp.
  - **Testnets:** Stripe's path explicitly says "Stripe's onramp does not support testnets". For the RN path (MoonPay or Coinbase), whether Monad testnet or even Monad mainnet MON is purchasable is **[unverified]**.
  - For a testnet demo this is weak. It can be shown against mainnet in sandbox mode only.
- **Crypto deposits** (persistent deposit addresses that auto-bridge or swap into a target asset) are built on wallet automations and the swap API, so they are mainnet by nature. Monad as a destination is **[unverified]**. Source: https://docs.privy.io/wallets/funding/crypto-deposits/overview.

### Webhooks, user management, export, MFA, cross-app
- **Webhooks:** `user.created`, `user.authenticated`, `linked_account`, `wallet_created`, `private_key_export`, `mfa.enabled`, and others, signed via svix (https://docs.privy.io/user-management/users/webhooks/handling-events). Transaction and balance webhooks are free in development; **production needs Enterprise** (https://docs.privy.io/wallets/gas-and-asset-management/assets/transaction-event-webhooks).
- **User API:** get or query users, custom metadata, delete users, allowlist and denylist. Sources: https://docs.privy.io/user-management/users/managing-users/querying-users and https://docs.privy.io/user-management/users/custom-metadata.
- **Export:** React and server only. A mobile app would open a hosted web page for "export key".
- **MFA:** passkey (recommended), TOTP or SMS. "Policy-based MFA" can require MFA only above a threshold (https://docs.privy.io/authentication/user-authentication/mfa/overview).
- **Global wallets:** use one wallet across Privy apps (https://docs.privy.io/wallets/global-wallets/overview). I did not confirm whether Monad has an ecosystem global wallet such as "Monad Games ID" **[unverified]**.

### Dashboard config Juno would need [verified docs]
1. **App ID** (Dashboard → Home → Retrieve API keys) and an **app secret** for the server (`@privy-io/node`).
2. **App client** for mobile (Configuration → App settings → Clients): **Allowed app identifiers** `fun.juno.app` (iOS `bundleIdentifier` and Android `package` from Juno's `app.json`), plus `host.exp.Exponent` only if you try Expo Go. **Allowed URL schemes**: `juno://` (Juno's `scheme`), needed for OAuth. The **Client ID** goes to `PrivyProvider clientId`. "An empty list will mean all requests are denied." Source: https://docs.privy.io/basics/get-started/dashboard/app-clients.
3. **Web client:** allowed origins for the Vercel web build, if `react-auth` is used there.
4. **Login methods** (email is the minimum) and embedded wallets: automatic EVM creation, or `createOnLogin` in code.
5. **TEE execution** (Wallets → Advanced).
6. **Fee sponsorship:** enable, select Monad Testnet, add credits.
7. **Authorization keys:** a key quorum for the plans signer. **Policies** for it.
8. **SIWE:** allowlisted domain if linking external wallets. **Passkeys:** relying-party domain with AASA / assetlinks.
9. **Webhook endpoint** (optional).

### Pricing [privy.io/pricing via WebFetch; unverified detail]
- The free "Developer" tier advertises "50K signatures and $1M transaction volume for free every month". Native gas sponsorship, funding, passkeys and SMS are listed on all plans. Scale is $299 or $499 per month by MAU.
- Sponsored gas itself is paid from prepaid credits (network cost plus a "convenience fee").

## 1.3 Monad's official templates [verified; cloned]

**`monad-developers/react-native-privy-embedded-wallet-template`** (branches `main`, `demo`; last push 2025-12-05)
- `main` is a skeleton: `PrivyProvider` with `supportedChains={[monadTestnet]}`, `createOnLogin: "users-without-wallets"`, and env `EXPO_PUBLIC_PRIVY_APP_ID` / `EXPO_PUBLIC_PRIVY_CLIENT_ID`.
- The README walks through the dashboard: email login, auto-create EVM wallets, adding the bundle id to the client's allowed identifiers.
- The `demo` branch holds the real app:
  - email OTP sign-in (`useLoginWithEmail`)
  - `AuthBoundary`
  - `PrivyElements`
  - `WalletContext`, which wraps `wallet.getProvider()` in viem `createWalletClient({ transport: custom(provider), chain: monadTestnet })`
  - MON and USDC balances
  - an ERC-20 USDC send via `provider.request({method:'eth_sendTransaction'})`
  - `signMessage`
  - receive and QR sheets
  - an `@privy-io/wagmi` config
- Pinned versions are old (`@privy-io/expo ^0.53.8`, Expo 53).

**`monad-developers/react-native-privy-pimlico-gas-sponsorship-template`** (last push 2025-12-04)
- `hooks/useSmartWallet.tsx` builds a **Kernel v0.3.1 smart account (EntryPoint v0.7)** with the Privy embedded wallet as owner: `toKernelSmartAccount({ owners:[embeddedWalletClient] })`.
- It adds `createPimlicoClient(EXPO_PUBLIC_PIMLICO_BUNDLER_URL)` as paymaster and `createSmartAccountClient({ chain: monadTestnet, paymaster })`. Its gas price comes from `pimlicoClient.getUserOperationGasPrice().fast`.
- The README shows single and **batched** (`calls: [...]`) sponsored transactions. You get the Monad Testnet bundler URL from the Pimlico dashboard.
- It does **not** use Privy's native `SmartWalletsProvider` or native sponsorship; it wires permissionless by hand. Versions: `@privy-io/expo ^0.57.0`, `permissionless ^0.2.52`.

Monad's resource list also links Next.js PWA templates (`next-serwist-privy-embedded-wallet`, `-smart-wallet`, `-0x-privy`) and a Monad blog post on Privy wallets signing rapid transactions without pop-ups (https://blog.monad.xyz/blog/build-2048).

## 1.4 Metropolis "Privy!" bounty: full text [verified]

A verbatim capture of the logged-in hackathon.monad.xyz bounty card, filed in `vaibhav0xq/turnstile/research/sources/official-07-bounty-privy.md`. It is corroborated by `EndPx/kairos/sources/TRACKS_RAW.txt` and `HackerFetch/Baret-Metropolis/Bounties.txt`:

> **Privy!** — Integrate Privy beyond authentication — login-only integrations will not qualify.
> Prize: $5,000 USD — single prize. Track: All tracks. Deadline: Oct 14, 2026 at 09:29 GMT+5:30.
> **About:** Your project must integrate Privy beyond authentication. Using Privy only for login/authentication will not qualify.
> **Judging criteria:** Demo must clearly show the functionality powered by Privy. Bonus points for meaningfully integrating multiple Privy features into the project.
> **Deliverables:** A project with a demo clearly showing Privy-powered functionality beyond login/authentication.
> **Resources:** docs.privy.io, docs.monad.xyz, developers.monad.xyz, Metropolis resources.

Juno's own `docs/METROPOLIS.md` notes that bounties are scored 40% bounty requirements, 30% technical, 20% Monad integration and 10% innovation.

**What a qualifying Juno demo can show (multiple features, each visible on screen):**
1. Email or passkey login creates an embedded wallet (baseline, not enough on its own).
2. The embedded wallet signs launches and buys through the existing `Signer` seam.
3. **Sponsored gas** on Monad testnet: a new user launches a post with 0 MON for gas.
4. **Signer + policy** executes a recurring "plan" buy while the app is closed. The policy is shown: launchpad only, `buy` to self only, capped per day.
5. **Link a mainnet wallet via SIWE**, which feeds the Nansen reputation feature (Part 2).
6. Optional: MFA on large sells (policy-based MFA), and a `user.created` webhook that provisions the Juno profile.

---

# Part 2: Nansen

## 2.1 API basics [verified]
- **Base URL:** `https://api.nansen.ai/api/v1/...`, almost entirely `POST` with JSON bodies. **Auth header:** `apikey: <key>` (https://docs.nansen.ai/getting-started/authentication). Keys come from https://app.nansen.ai/auth/agent-setup.
- **Plans and credits** (https://docs.nansen.ai/getting-started/credits):
  - **Free:** 100 one-time trial credits, then a daily top-up to a 10-credit balance. Free covers all endpoints available in Pro, and credits can be purchased.
  - **Pro:** $49/month billed annually or $69/month billed monthly, with a 2,000-credit floor topped up monthly.
- **Credit costs** that matter for Juno:

| Endpoint | Credits |
|---|---|
| `search/general`, `search/entity-name` | 0 |
| profiler `current-balance`, `transactions`, `related-wallets`, `pnl-summary`, `pnl`, `first-funder`; TGM `token-information`, `flows`, `flow-intelligence`, `who-bought-sold`, `dex-trades`, `transfers`; `token-screener` | 1 each |
| smart-money `netflow`, `holdings`, `dex-trades`, `pnl-leaderboard`; profiler `counterparties`; `tgm/holders`; `tgm/indicators` | 5 each |
| `profiler/address/labels` | **100** |
| `profiler/address/premium-labels` (smart money, alpha trader, public figure) | **500** |
| `agent/fast` | 200 |
| `agent/expert` | 750 |

  The `first-funder` cost is confirmed from `openapi.json` `x-credits`.
- **Rate limits** (https://docs.nansen.ai/getting-started/rate-limits): Free is 15/s and 300/min; Pro is 75/s and 1,500/min. A 429 comes with `Retry-After`.
- **Agentic payments, no key** (https://docs.nansen.ai/getting-started/agentic-payments): x402 in "USDC on Base, Solana, or Monad", or MPP on Tempo. Pricing is Basic $0.01, Premium $0.05 and Smart Money $0.05 per call. The discovery doc says "$0.01-$7.50 per request".
  - **Labels endpoints are excluded** ("Pro subscription only").
  - **Live probe:** an unpaid `POST /api/v1/profiler/address/pnl-summary` returned `402` with `accepts` including `eip155:143`, asset `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` ("USDC"), amount `10000` ($0.01). It also accepts Base USDC, X Layer, BSC stables and Solana.
  - `GET https://api.nansen.ai/.well-known/x402` lists 86 priced resources.
- **CLI:** `nansen-cli` 1.46.0 on npm (github.com/nansen-ai/nansen-cli). JSON output; `nansen schema` is free and keyless; it can install the MCP server into Cursor. Source: https://docs.nansen.ai/cli.
- **MCP server:** `https://mcp.nansen.ai/ra/mcp` with the `NANSEN-API-KEY` header. It exposes 24 tools, each with a credit cost; `general_search` is free for token and entity queries but costs 500 credits for address lookups. Claude Code: `claude mcp add --transport http nansen https://mcp.nansen.ai/ra/mcp --header "NANSEN-API-KEY: …"`. Sources: https://docs.nansen.ai/mcp/connecting and https://docs.nansen.ai/mcp/tools.
- **Nansen Points (Permissionless Rewards):** public, **no auth, no credits**. `GET https://app.nansen.ai/api/points-leaderboard/api?tier=&page=&recordsPerPage=` and `GET https://app.nansen.ai/api/points-leaderboard/{address}` map Nansen Points (tiers Green, Ice, North, Star) to opt-in EVM and Solana wallets. A live probe returned 200 with 598,764 entries. Source: https://docs.nansen.ai/api/points.

## 2.2 Endpoint families and Monad support [verified: docs chain matrix plus `openapi.json` enums]
Chain matrix: https://docs.nansen.ai/reference/chains. Coverage dates: https://docs.nansen.ai/api/data-coverage (**Monad from 14 May 2025**; live data within seconds to minutes).

| Family | Endpoints | `monad`? |
|---|---|---|
| **Smart Money** | `smart-money/netflow` (rolling 1h/24h/7d/30d; 30-day retention), `holdings`, `dex-trades`, `historical-holdings`, `pnl-leaderboard`. Perp trades are Hyperliquid-only; DCAs are Jupiter-only. Labels: Smart Trader, 30D/90D/180D Smart Trader, (Fund, deprecated for current holdings) | ✅ Netflow / DEX trades / Holdings / **Historical** (Monad is one of only 7 chains with Historical) |
| **Token God Mode** | `token-information`, `indicators`, `token-ohlcv`, `token-screener`, `flow-intelligence` (flows by segment: exchanges, smart money, public figures, whales), `holders`, `flows`, `who-bought-sold`, `dex-trades`, `transfers`, `pnl-leaderboard` | ✅ Flows / Transfers / Holders / PnL |
| **Profiler** | `current-balance`, `historical-balances`, `transactions`, `dex-trades`, `counterparties` (plus batch of 10), `related-wallets`, `first-funder` (EVM, chain fixed to `all`), `pnl-summary` (realized PnL, win rate, top-5 tokens), `pnl`, `labels`, `premium-labels` | ✅ Balance / Transactions / PnL / Related; `monad` appears in `ProfilerLabelsChain` |
| Other | `search/*`, `chains/chain-rank`, `nansen-score/top-tokens`, `portfolio/defi-holdings`, `agent/fast|expert`, `smart-alerts` (Telegram, Slack, Discord), prediction markets (Polymarket), backtesting (`v1beta1`), trading (DEX swap quote, prepare, execute; Hyperliquid perps) | `monad` appears in `TokenScreenerChain`, `NansenScoreTopTokensChain`, `TGMOHLCVChain`, `TransactionLookupChain` |

**Testnet [verified negative].**
- `openapi.json` (804 KB) contains the string `monad` 20 times, always as the plain chain value, and **never "testnet"**.
- The docs' own AI answer: "Nansen's API doesn't document support for Monad testnet … the supported-chains list does not distinguish testnet vs mainnet."
- That `monad` means chain 143 is an inference **[unverified mapping]**. It is consistent with x402 listing `eip155:143`.
- The 14 May 2025 start date predates Monad's public mainnet launch (late Nov 2025). I could not resolve this discrepancy **[unverified]**.

## 2.3 Redistribution rules decide what Juno can show [verified]
https://docs.nansen.ai/guides/redistribution-guide (updated 18/11/2025) and https://docs.nansen.ai/mcp/redistribution-guidelines.

- **Allowed, no attribution needed:** profiler balances, historical balances, **pnl and pnl-summary**, perp positions and trades.
- **Allowed with attribution** ("Powered by Nansen API" or a link): profiler transactions, counterparties, related-wallets; `tgm/transfers`, `token-screener`, `dex-trades`, `who-bought-sold`, `flow-intelligence`, `flows`.
- **Restricted** (approval form plus "significant modification", meaning combined with another substantial independent source and not reverse-engineerable): `tgm/holders` with a smart-money filter, `smart-money/inflows`. Netflow is presumably in this class **[unverified mapping]**.
- **Prohibited in any public or customer-facing interface:** **`address/labels`**, `smart-money/holdings`, **`smart-money/dex-trades`**, `smart-money/dcas`, `smart-money/perp-trades`, `tgm/pnl-leaderboard`, `perp-leaderboard`. Internal use is fine.
- `first-funder` is not listed. Treat it as internal-only **[unverified]**.

The consequences for Juno:
- A visible "Smart Money" badge or "Nansen label" on a profile or leaderboard breaks the rules.
- A "smart money is buying X" feed item breaks them too, unless it is transformed and approved.
- A composite score derived from several signals, including Juno's own on-chain data, is precisely the "Custom Composite Indicators" example the guide marks as allowed (with approval where smart-money data feeds it). It also matches the bounty's "goes beyond exposing raw data".

## 2.4 Metropolis "Best use of Nansen" bounty [verified title and summary; no fuller card found]
> **Best use of Nansen** — Nansen AI — Build a product experience powered by Nansen data/API/MCP/CLI that goes beyond exposing raw data. All tracks. $5,000 USD total prize pool.

Sources: `EndPx/kairos/sources/TRACKS_RAW.txt` and `HackerFetch/Baret-Metropolis/Bounties.txt`, both copied from the platform. I found no About, Judging-criteria or Deliverables block for Nansen in any public repo (searched GitHub code for the phrasing, "Best use of Nansen" with "Judging" or "Deliverables", and "Nansen data/API/MCP/CLI").

The Privy card's format suggests Nansen's card is similar ("demo must clearly show…"), but that is **[unverified]**. The "Growth Lead, API & CLI" mentor did not appear in the participant snapshot of the mentors page **[unverified]**. The judges snapshot (`official-10-prizes-judges.md`) lists **Alex Svanevik, Nansen CEO, as a main-track judge**.

## 2.5 What Nansen can honestly add to Juno

**The core constraint.** Juno's tokens, trades, curves and graduations are on Monad **testnet**. Juno's wallets are fresh device keys or fresh Privy embedded wallets. **Nansen has nothing on either.** Any Nansen feature must attach to something that exists on mainnet: a user's *other* wallet, or MON and Monad-mainnet tokens.

### Strong: "Proven trader" reputation from a linked mainnet wallet (Privy + Nansen together)
1. In Juno, the user links an existing mainnet wallet with Privy `useLinkWithSiwe`. This proves ownership, and it is itself a Privy feature beyond login.
2. The Juno server profiles that address once and caches the result for about a day. Allowed inputs and costs:
   - `pnl-summary` on `monad` and `ethereum` or `base`: realized PnL, win rate, trade count. 1 credit or $0.01 each; freely redistributable.
   - `current-balance`: 1 credit; free to show.
   - `related-wallets` and `counterparties`: attribution required.
   - `first-funder`: internal only.
   - Nansen Points tier from the public endpoint: free.
3. Juno computes a **composite** tier or score with its own inputs: account age, whether the user holds positions in Juno posts (from Envio), and whether their buys were early on posts that later filled or graduated. **It does not show Nansen labels.**
4. Where it shows up:
   - a badge and "who is this trader" card on the leaderboard and creator profiles (aggregates only, "Powered by Nansen API")
   - **"Proven traders are buying this reel"**, meaning Juno's own testnet buyers weighted by their Nansen-derived mainnet score. This is the honest replacement for `docs/METROPOLIS.md`'s "Smart money is buying this reel", which is impossible for testnet tokens and prohibited as raw display anyway.
   - creator credibility at launch, as an anti-rug signal
5. **Anti-sybil and wash trading.** The rules name wash trading as grounds for disqualification, so this also has a direct hackathon link.
   - Weight leaderboard rank, fee rebates or airdrop eligibility by linked-wallet reputation. A wallet with real mainnet history, PnL and diverse counterparties is costly to fake.
   - Flag clusters of Juno accounts whose linked wallets share a first funder or appear in each other's `related-wallets`, and use that internally.
6. Cost per profile is about $0.03–0.09 over x402, or about 3–9 credits. The **free plan's 100 one-time credits plus 10 a day** covers a demo only if **labels are avoided**.
7. **Honest limits.**
   - It works only for users who choose to link a mainnet wallet.
   - Linking a mainnet wallet from inside a mobile app needs an external wallet signature, via WalletConnect/Reown or copy-paste signing. `@privy-io/expo/connectors` only ships Phantom and Backpack (Solana) deeplink connectors.
   - Testnet trading behaviour is invisible to Nansen, so the score measures *who* someone is elsewhere, not how they trade on Juno.

### Strong for Monad integration: pay Nansen per call with x402 in USDC on Monad mainnet
- The Juno server gets a Privy **server wallet** (`@privy-io/node`), funded with a few dollars of Monad-mainnet USDC. It calls Nansen through `wrapFetchWithPayment(fetch, createX402Client(privy, {walletId, address}))`, with no Nansen API key and no subscription.
- Every lookup is a visible Monad mainnet USDC settlement. It touches both sponsors and gives a concrete answer to "Monad integration".
- Two parts are **[unverified]**: that Privy's `createX402Client` and `@x402/evm` sign for `eip155:143` without extra config, and that Nansen's facilitator settles on Monad. The latter is advertised in the 402 challenge but untested.
- It **cannot** pay for labels endpoints.

### Weak or forced (say so if used)
- **MON market context strip** (`tgm/token-information` and `flow-intelligence` for MON on `monad`, attribution required). It is decorative for a testnet social app and not part of Juno's core loop.
- **Smart-money netflow on Monad tokens** as a "what's hot on Monad mainnet" discovery rail. It is restricted (needs approval plus transformation), and it is unrelated to Juno's own posts.
- **Nansen AI agent** (`agent/fast`, 200 credits, or x402) to write a one-line "who is this trader" blurb. Expensive, and the output mostly restates the PnL data.
- **Labels on the leaderboard** (for example "Binance-funded", "Smart Trader"). Prohibited to display, and 100–500 credits per call.
- **Anything about Juno's own tokens or testnet wallets.** No data exists.

---

## Open questions and things to verify with keys or a dashboard
1. Is a new Privy app TEE-enabled by default, or must you request migration? This is needed for native sponsorship, policies and signers.
2. Does Privy native sponsorship on Monad Testnet consume paid credits, or is it free on testnets?
3. Does `eth_signTransaction` on the Expo provider accept `type: "eip1559"`, or does it need `2`? Does TEE signing honour a caller-supplied `nonce`, `gas` and fees exactly? The code says yes; test it end to end.
4. Does server-side `sendTransaction` on `eip155:10143` work without `sponsor`? Privy needs its own RPC for the chain.
5. Does `@privy-io/react-auth` run inside Expo web (Metro web) for Juno's web build?
6. Does Nansen's `monad` cover chain 143 only (it presumably does), and why does coverage start on 14 May 2025?
7. Does x402 on `eip155:143` work end to end with Privy's `createX402Client`?
8. What is the full Nansen bounty card (judging criteria)? Ask in the Metropolis Discord or at a mentor office hour.
9. Should Juno file the Nansen redistribution approval form (https://forms.gle/AoXk9jRdbuiqqG5f9) if any smart-money-derived input feeds the public composite score?
