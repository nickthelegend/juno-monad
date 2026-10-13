# Sponsor coverage: every Monad Metropolis sponsor, and what Juno does with it

Statuses (13 Oct 2026):
- **working**: load-bearing in the product, tested, with a live Monad testnet transaction;
- **partial**: built and tested, but one step is the owner's;
- **not used**: with the reason.

Hashes are in [evidence/testnet-13oct.md](evidence/testnet-13oct.md).

**Working: 6 sponsors (plus Pyth, a Monad oracle). Partial: 3 (Privy, MetaMask, Kimi). Not used or indirect: 15.**

| Sponsor | Status | In Juno | Proof (Monad testnet) |
|---|---|---|---|
| **Kuru** | **working** | Every Kuru-venue coin graduates into its own new Kuru market, seeded from the curve. The app trades its book (market and limit orders, cancel), and fills are recorded from receipts. | Graduation `0x04de4115…5bda`, buy `0xe68f8fff…65d6`, sell `0x2c58097c…7058` |
| **Perpl** | **working** | Perps tab with live markets, positions and a risk view; deposit, open and close through `execOrder`; a funding-carry bot (`scripts/perpl-bot.ts`). | Deposit `0x7889568e…1564`, 2x BTC long `0x3f81ae5a…864b`, close `0x429d63aa…a890` |
| **Agora (AUSD)** | **working** | AUSD is the perps margin, with an in-app Agora AUSD faucet. | 10,000 AUSD from the faucet `0x6bd741fb…dd84` |
| **Chainlink (CRE + Data Feeds)** | **working** (simulated workflow) | `cre/juno-nav` attests tracker NAV to `JunoNavOracle` (consensus over Tessera, Pyth, the USDC/USD Data Feed and the launchpad). Run with `cre workflow simulate --broadcast` through the MockKeystoneForwarder, not a deployed DON. Coin pages show the badge. | Report `0xc777646c…2b10`; oracle `0x2DF370b2…DC9f` (verified) |
| **Mera** | **working** | Passkey accounts (a plain EOA derived from the passkey's PRF output): one tap, signing sessions, sealed drafts (secret vault). The passkey's signature is checked by Monad's P256 precompile through an `eth_call` (a read, so no tx). | Buy signed by a passkey session `0xdaddc274…ac96` |
| **Envio** | **working** | HyperIndex v3 over the launchpad, tokens, the Kuru graduator, Kuru markets and v2 pairs; positions, holders, open orders. Hosted on Railway. | `GET /api/juno/coins/<token>` returns `holdersSource: "indexer"` and `indexer.behind` |
| **Privy** | partial |  Embedded wallets sign every launch and trade. Autopilot: per-wallet policies plus a server key quorum signer (`ug763ortcvm9selpnlh0webd`, registered 13 Oct on the shared app). | Signer registered via Privy's API. The dashboard origins and gas sponsorship are the owner's (`doitlater.md`). |
| **Pyth** (Monad price oracle) | **working** | MON/USD and stock trackers' NAV, on chain and through Hermes. | Read in every receipt's USD and in the CRE report |
| **MetaMask** (Agent Wallet plugin) | partial | `mm-plugin-juno`: `mm juno markets/coin/buy/sell/portfolio`, built and tested sandboxed. | `mm` is not installed or logged in on the owner's machine (`doitlater.md`) |
| **Kimi** | partial (by rule) | `mm juno ask` plans trades with Kimi. | Juno may not use the shared Moonshot key, so it reports "not configured" |
| Nansen | not used | Mainnet wallet data; Juno's coins are testnet. Key reserved for others. | — |
| Zerion | not used | Allocated to Polaris. | — |
| Dynamic | not used | A third account layer beside Privy and Mera. | — |
| Alchemy | not used | Public RPC plus Envio cover reads. | — |
| Cleanverse | not used | No compliance-gated flow in a testnet social market. | — |
| Qwen | not used | No key issued. | — |
| Tencent Hunyuan | not used | Track 3 (KOMA's). | — |
| Aurora Intents | not used | Mainnet-only, real funds. | — |
| Mercuryo | not used | Mainnet-only fiat on-ramp. | — |
| BlockVision | used indirectly | Its Sourcify endpoint verified every Juno contract; MonadVision links. | Oracle verification, 13 Oct |
| Tenderly | not used | Simulation is `eth_call` plus explicit gas limits. | — |
| QuickNode | not used | Public RPC. | — |
| Chainstack | not used | Public RPC. | — |
| Dwellir | not used | Public RPC. | — |
| Spectrum | not used | Public RPC. | — |

The Monad-native items (commit-state strip, two-timer receipts, txpool status, P256 passkeys, staking reads, gas and reserve rules, canonical contracts) are in [MONAD-NATIVE.md](MONAD-NATIVE.md). Their live numbers are in the evidence file: a buy executed in 416 ms and final in 579 ms; 295 ms blocks.
