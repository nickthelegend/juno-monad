# Live testnet evidence, 13 Oct 2026

Every hash is a real Monad testnet transaction (chain 10143), sent through
the hosted API (`juno-api-production-04ea.up.railway.app`) the way the app
sends it. Open any of them at `https://testnet.monadvision.com/tx/<hash>`.

## Juno core, and Monad's speed
- JunoNavOracle deployed, Sourcify-verified: `0x2DF370b26CaDBCf94Df3e6766B9f7D91Bf36DC9f`, tx `0xf3a0d31abb98bbad6778846be81eb1fe6de181d9c491f7a74307178e0b418a73`
- Hosted faucet to a fresh wallet: `0xcb6133001afcbe0c6caa58232a06a0480806e992aca2f5164a99dfc8616dd4b7`
- Buy of $GENESIS through the hosted API: `0x25238c32a06aa6fe7d6d3acd280570593fc2a6a38171a350e16c45e7e7be7e96`. Executed in 416 ms, final in 579 ms. Live strip: 295 ms blocks, voted 292 ms, verified 1.5 s.

## Agora AUSD and Perpl (one fresh wallet, `.juno/sponsor-proof.mjs`)
- Juno faucet (MON): `0xddeb556294b4807dc100aed68961dc52413b8d663de74594c3d858f1e0f54b18`
- Agora AUSD faucet, 10,000 AUSD: `0x6bd741fb729021b61fc37a41eb3e7d3188a8bf787e4a3258f857ff12ae92dd84`
- Perpl: AUSD approval `0xd42a8faa56901a306083ef31a3ccac286b813013afd25b7d8fdfb6ebf40e58ce`, account and deposit `0x7889568e2bb65cd1b0ac01b6338bb8d6407c95c254165a61573e037e38cc1564`
- Perpl 2x BTC long opened (47 lots at 83,372.7): `0x3f81ae5afaf036f4b38b1e94f4b9bccc10fad402db8b735afa613088b011864b`
- Perpl long closed: `0x429d63aac297846255bbb09d3751de8943afa5e094a3171dbafcc2f5c7cca890`

## Kuru: a coin graduates into its own new Kuru market, then trades on it (demo seed)
- $GRADKURU `0x79513F4Ac0B112E690679dBea4A02d468B92bAB8` launched: `0xd30f0311baaf1eec56d7f64fd990bc318c0cf201ce3f5b3b9f85b1612a142b1a`
- Graduated into its new Kuru market `0xD2175fd455bb91d631c9ca95E69902fED171a144`, seeded from the curve: `0x04de4115b0a993676289c9c94b98f9d96f5927c5ea56d1262312dce5ef715bda`
- Buy on Kuru's book: `0xe68f8fff7035bd65adf7699621e7b88be3e015731e0082034c66e08355f665d6`. Sell: `0x2c58097c9843ae74dda6cb2da3e97d95ade00c6ffe7ca27d553c02eb127b7058` (both recorded from the receipts, tagged KURU in the coin's activity)
- Also a Uniswap v2 graduation: $GRADV2, `0xdc992728203c0a961d93d1e3b365416560babd55e592e3f59a0e704b0663697a`

## Chainlink CRE: NAV attested on Monad testnet
- `cre workflow simulate juno-nav --target staging-settings --broadcast` (the CRE CLI). It read Tessera over HTTP with consensus, plus Pyth, Chainlink's USDC/USD feed and the launchpad. One report through the MockKeystoneForwarder attested OPENAIX, KALSHIX and SPACEXX: `0xc777646ce8fee4d90e5da2fa2244b8ea84ddde8e40bb02b914f0e0ea0abb2b10`
- `JunoNavOracle.reportCount()` = 1. The hosted API serves the attestation (OPENAIX: NAV $812.79, premium −0.35%, inside its 2% band).

## Mera: a passkey account on the hosted app (Chrome's virtual authenticator, PRF)
- Account `0x9AE15297D820a40b33971c360c4ccbaE5C7102D8`, made in one tap from the no-wallet profile. Faucet: `0xa2ad9ae596024a94aa7de93c773d9791b15450251f35aaca0103e29fd16da696`
- It bought $BLOOM, signed by the passkey session: `0xdaddc274487914411eaea54d8792297482d0eefdd77d7d85d5e5be73b15aac96`, executed in 303 ms
- Passkey proved by Monad's P256 precompile (`eth_call` to `0x0100`), shown on the profile.

## Envio
- The hosted HyperIndex serves holders for the new coins, 0 blocks behind the chain.

## Demo content (`scripts/juno-demo.ts --round all` through the hosted API)
- 14 coins: 5 reels, 2 photos, 3 pre-IPO trackers (OPENAIX, KALSHIX, SPACEXX), 2 stock trackers, and the two graduated coins, with trades, comments and a creator fee claim. Hashes are in `.juno/demo/monad-testnet/progress.json`.
