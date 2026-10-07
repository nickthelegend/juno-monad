import type { Chain } from "viem";
import { monad, monadTestnet } from "viem/chains";

/**
 * viem's Monad chains, corrected for the app (the server has the same in
 * lib/juno/network.ts). viem 2.57 still says 400 ms blocks and points at an
 * old explorer; Monad blocks are 300 ms since v0.15.0 and the explorer is
 * MonadVision.
 */
export const monadTestnetChain: Chain = {
  ...monadTestnet,
  blockTime: 300,
  blockExplorers: { default: { name: "MonadVision", url: "https://testnet.monadvision.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
};

export const monadChain: Chain = {
  ...monad,
  blockTime: 300,
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
};
