# How Juno uses Mera: one passkey is the whole account

*Juno · Monad Metropolis, Track 01 · live at https://juno-monad-app.vercel.app (Monad testnet)*

Juno is a social feed where every post is a market. A photo or a reel launches its own coin on a bonding curve on
Monad in one transaction. Fans buy it straight from the feed, and the creator earns the trading fees. When a curve
fills, the coin graduates into its own Kuru order book (or a Uniswap v2 pair, if the creator chose that at
launch).

## The problem Mera solves: a feed of one-tap buys needs a one-tap account

Juno's buy button sits under a reel. If the first tap means "install an extension and write down 12 words", the
feed has lost that person; if every buy prompts for a signature, small trades get tiring. Juno needed an account
that:
1. is created in one prompt, with nothing to write down;
2. comes back on any device, or after the browser is cleared, with nothing secret stored anywhere;
3. signs a run of trades without prompting each time, and can be locked again.

Mera, Category Labs' passkey library, provides all three. Juno also uses the same passkey for a second, non-wallet
job: sealing drafts.

## How it works

### 1. The passkey's PRF output becomes an ordinary EVM key

[`juno-expo/lib/mera.ts`](../juno-expo/lib/mera.ts) calls Mera's `createPasskeyWithPrfOutput`. The WebAuthn PRF
output is 32 bytes the authenticator derives from the passkey and the site, the same every time. Juno turns it
into a standard wallet and wipes every intermediate value:

```ts
/** PRF output → the account's private key, wiping every intermediate. */
function deriveKey(prfOutput: Uint8Array): Uint8Array {
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const seed = mnemonicToSeedSync(mnemonic);
  const child = HDKey.fromMasterSeed(seed).derive(PATH);
  const key = child.privateKey;
  seed.fill(0);
  prfOutput.fill(0);
```

`PATH` is `m/44'/60'/0'/0/0`. The account is a **plain EOA**: no smart account and no bundler, and any wallet
could import the key. Only `{address, credentialId}` is stored, and neither is a secret. "Sign in with my passkey"
calls `getPasskeyPrfOutput`, derives the same key, and gets the same address back.

### 2. Signing sessions

Mera's `createSecp256k1SigningSession` holds the key, wrapped as a viem account, and signs without prompts for
`SESSION_MS` (15 minutes). The profile shows a countdown, and *End session* calls `signing.end()`,
which zeroes the key. The next signature after that asks for the passkey once, checks it is the same account, and
opens a new session. A different passkey is refused with "That passkey belongs to a different Juno account".

### 3. One passkey, many keys: sealed drafts

A creator can seal a post's name, ticker and caption before publishing. Mera's `createSecretVaultWithExistingPasskey`
encrypts them under a key from the same passkey's PRF, but with a fresh random salt for each vault. That gives each
draft its own key, separate from the one that derives the wallet. Juno's server keeps only the vault
([`lib/juno/drafts.ts`](../lib/juno/drafts.ts)) and checks its shape without being able to open it:

```ts
vault.version === 1 &&
typeof credential?.credentialId === "string" &&
// …
typeof vault.prfSalt === "string" &&
B64URL.test(vault.prfSalt) &&
vault.prfSalt.length === 43 &&
typeof vault.nonce === "string" &&
```

Writes and deletes are signed by the wallet (EIP-191; no prompt in a session). On any device with the passkey,
Open asks once and fills the composer ([`juno-expo/lib/drafts.ts`](../juno-expo/lib/drafts.ts)).

### 4. The passkey checked by Monad's P256 precompile

A passkey signs with P-256. To show the account really is a passkey, the profile can prove it on Monad:
1. the passkey signs a server challenge (a WebAuthn assertion);
2. the wallet signs a message naming the passkey's public key;
3. the server sends the assertion to Monad's P256 precompile at `0x0100`
   ([`lib/juno/passkey-link.ts`](../lib/juno/passkey-link.ts)).

```ts
// Monad's own code decides: the P256 precompile, called as a contract would.
const data = p256Input(webauthnDigest(authenticatorData, clientDataJSON), rs.r, rs.s, x, y);
const answer = await publicClient()
  .call({ to: P256_PRECOMPILE, data })
```

That `call` is an `eth_call`: a read that runs the chain's own code, not a transaction. If it returns
`0x…01`, the profile shows "Passkey verified on Monad".

## Engineering notes

- **Capturing the public key.** Mera does not keep the passkey's public key, but the precompile needs it. So
  [`mera-client.ts`](../juno-expo/lib/mera-client.ts) is Mera's browser client copied line for line, plus one
  addition: it saves `getPublicKey()` at creation.
- **DER to (r, s).** WebAuthn returns an ASN.1 DER signature, and the precompile wants 32-byte `r` and `s`.
  `derToRS` in [`passkey-verify.ts`](../lib/juno/passkey-verify.ts) strips the padding and rejects trailing bytes.
  The digest is `sha256(authenticatorData ‖ sha256(clientDataJSON))`, and `checkClientData` confirms the
  assertion answered this challenge.
- **Stateless challenges.** Time, a nonce and an HMAC (with the wallet), valid five minutes; nothing stored.
- **Sessions live in memory by design.** A full page reload locks the session, and the next signature asks once.
- **PRF support varies.** Errors say what to do: iOS 18 with iCloud Keychain, or Google Password Manager on
  Android.

## The value it brought

- **Time to first transaction.** One passkey prompt creates the account. In the 5 Oct hosted test, the first
  transaction (Agora's AUSD faucet) landed in 1.6 s with no further prompts.
- **Nothing to lose, nothing stored.** Clear storage, sign in with the passkey, and the same address returns.
- **A second use of the same key material.** Sealed drafts protect content, not just a wallet.
- **Monad-native proof.** The P256 precompile lets the chain itself confirm a passkey signature.

## Live proof (Monad testnet)

On 13 Oct a passkey account (`0x9AE15297D820a40b33971c360c4ccbaE5C7102D8`) was created in one tap on the hosted
app, using Chrome's virtual authenticator with PRF. After the faucet funded it, it bought $BLOOM, signed by the
passkey session. The buy executed in 303 ms:
[0xdaddc274…ac96](https://testnet.monadvision.com/tx/0xdaddc274487914411eaea54d8792297482d0eefdd77d7d85d5e5be73b15aac96)

The same account's passkey was then proved by the P256 precompile and shown on the profile. That check is an
`eth_call` to `0x0100`, so it has no transaction hash.

## Honest limits

- **Plain EOAs.** Mera accounts in Juno are ordinary secp256k1 EOAs derived from the PRF output. The P256
  precompile is only used to prove the passkey. It does not authorise transactions.
- **Native apps don't capture the passkey's public key yet.** `takeCreatedPublicKey()` returns null on iOS and
  Android, so proving a passkey on Monad works in the web app only. Sealed drafts are web-only too, because Mera's
  secret vaults call `navigator.credentials` directly.
- **No native ceremony has run.** It needs the owner's Apple team id and Android release certificate.
- **Not tested across real devices.** The proofs used Chrome's virtual authenticator, which cannot export a
  credential with its PRF secret; a cross-device test needs two real devices with a synced passkey.
