import { afterEach, describe, expect, it } from "vitest";

import {
  chainId,
  explorer,
  launchpadAddress,
  launchpadDeployBlock,
  network,
  networkKey,
  requireLaunchpad,
  rpcEndpoint,
  usingPublicRpc,
} from "@/lib/juno/network";

/**
 * Which Monad Juno talks to.
 *
 * The rule worth pinning is the default: a missing or mistyped variable must
 * land on testnet, never on real money, and an unset launchpad must say so
 * rather than calling the zero address.
 */

const KEYS = [
  "NEXT_PUBLIC_MONAD_NETWORK",
  "MONAD_RPC_URL",
  "NEXT_PUBLIC_MONAD_RPC_URL",
  "NEXT_PUBLIC_JUNO_LAUNCHPAD",
  "JUNO_LAUNCHPAD_DEPLOY_BLOCK",
] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("network", () => {
  it("is testnet unless mainnet is asked for by name", () => {
    for (const value of [undefined, "", "Mainnet", "main", "testnet"]) {
      if (value === undefined) delete process.env.NEXT_PUBLIC_MONAD_NETWORK;
      else process.env.NEXT_PUBLIC_MONAD_NETWORK = value;
      expect(network(), `NEXT_PUBLIC_MONAD_NETWORK=${value}`).toBe("testnet");
    }
    expect(chainId()).toBe(10143);
    expect(networkKey()).toBe("monad-testnet");
  });

  it("switches every derived value together on mainnet", () => {
    process.env.NEXT_PUBLIC_MONAD_NETWORK = "mainnet";
    expect(network()).toBe("mainnet");
    expect(chainId()).toBe(143);
    expect(networkKey()).toBe("monad");
    expect(explorer.tx("0xabc")).toBe("https://monadvision.com/tx/0xabc");
  });

  it("links to MonadVision on testnet", () => {
    delete process.env.NEXT_PUBLIC_MONAD_NETWORK;
    expect(explorer.tx("0xabc")).toBe("https://testnet.monadvision.com/tx/0xabc");
    expect(explorer.address("0xdef")).toBe("https://testnet.monadvision.com/address/0xdef");
    expect(explorer.token("0x123")).toBe("https://testnet.monadvision.com/token/0x123");
  });

  it("prefers a dedicated RPC and says when it is on the public one", () => {
    delete process.env.NEXT_PUBLIC_MONAD_NETWORK;
    delete process.env.MONAD_RPC_URL;
    delete process.env.NEXT_PUBLIC_MONAD_RPC_URL;
    expect(usingPublicRpc()).toBe(true);
    expect(rpcEndpoint()).toMatch(/^https:\/\//);

    process.env.MONAD_RPC_URL = " https://rpc.example/key ";
    expect(rpcEndpoint()).toBe("https://rpc.example/key");
    expect(usingPublicRpc()).toBe(false);
  });
});

describe("launchpad address", () => {
  it("is null, and required loudly, when unset or malformed", () => {
    delete process.env.NEXT_PUBLIC_JUNO_LAUNCHPAD;
    expect(launchpadAddress()).toBeNull();
    expect(() => requireLaunchpad()).toThrow(/NEXT_PUBLIC_JUNO_LAUNCHPAD is not set/);

    process.env.NEXT_PUBLIC_JUNO_LAUNCHPAD = "0x1234";
    expect(launchpadAddress()).toBeNull();
  });

  it("is checksummed whatever case it was configured in", () => {
    process.env.NEXT_PUBLIC_JUNO_LAUNCHPAD = "0x91b3125f2ffe2eb48dd602cc203c2c2368045b91";
    expect(launchpadAddress()).toBe("0x91b3125f2ffe2eB48dd602CC203C2c2368045B91");
  });

  it("reads the deploy block, or zero when it is not a number", () => {
    process.env.JUNO_LAUNCHPAD_DEPLOY_BLOCK = "65104284";
    expect(launchpadDeployBlock()).toBe(65_104_284n);
    process.env.JUNO_LAUNCHPAD_DEPLOY_BLOCK = "soon";
    expect(launchpadDeployBlock()).toBe(0n);
  });
});
