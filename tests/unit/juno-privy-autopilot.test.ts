import { createPublicKey, verify } from "node:crypto";

import { PrivyClient, formatRequestForAuthorizationSignature } from "@privy-io/node";
import { describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress, parseEther } from "viem";

import { junoLaunchpadAbi } from "@/lib/juno/abi";
import { generateAuthorizationKey, privySendInput } from "@/lib/juno/privy-keys";
import { tradingPolicy } from "@/lib/juno/privy-policy";

/**
 * Autopilot's two calls to Privy, made with Privy's own SDK against a stub
 * of Privy's API: the body that reaches the wire, and the authorization
 * signature on it, which must verify against the key quorum's public key.
 */

type Captured = { url: string; method: string; headers: Record<string, string>; body: unknown };

function stubbedPrivy(answer: unknown) {
  const captured: Captured[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value));
    captured.push({ url: String(input), method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new PrivyClient({ appId: "test-app-id", appSecret: "test-app-secret", fetch: fetch as typeof globalThis.fetch });
  return { client, captured };
}

const wallet = getAddress("0x1111111111111111111111111111111111111111");
const launchpad = getAddress("0xa8b009c7848c9f4Fd4dD9447a385DaFB8B865c81");
const coin = getAddress("0x14092A529e2e5EB4DECB4a1828f6aFa72e026360");

describe("autopilot through Privy's SDK", () => {
  it("creates the wallet's policy with the body Privy documents", async () => {
    const policy = tradingPolicy({ wallet, chainId: 10143, launchpad, router: null, usdc: null, maxValueWei: parseEther("5"), expiresAt: 1_790_000_000 });
    const { client, captured } = stubbedPrivy({ id: "policy-1", ...policy, created_at: 0, owner_id: null });
    const created = await client.policies().create(policy as never);
    expect(created.id).toBe("policy-1");
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe("https://api.privy.io/v1/policies");
    expect(captured[0].headers["privy-app-id"]).toBe("test-app-id");
    expect(captured[0].body).toEqual(JSON.parse(JSON.stringify(policy)));
  });

  it("sends a sponsored eth_sendTransaction for the wallet, signed by the authorization key", async () => {
    const key = generateAuthorizationKey();
    const call = {
      to: launchpad,
      value: parseEther("1"),
      data: encodeFunctionData({ abi: junoLaunchpadAbi, functionName: "buy", args: [coin, parseEther("1"), 1n, wallet, 1_790_000_300n] }),
    };
    const hash = `0x${"ab".repeat(32)}`;
    const { client, captured } = stubbedPrivy({ method: "eth_sendTransaction", data: { caip2: "eip155:10143", hash } });
    const sent = await client
      .wallets()
      .ethereum()
      .sendTransaction("wallet-123", privySendInput(call, { chainId: 10143, sponsor: true, authorizationKey: key.privateKey }));
    expect(sent.hash).toBe(hash);

    const [request] = captured;
    expect(request.url).toBe("https://api.privy.io/v1/wallets/wallet-123/rpc");
    expect(request.body).toEqual({
      method: "eth_sendTransaction",
      chain_type: "ethereum",
      caip2: "eip155:10143",
      sponsor: true,
      params: { transaction: { to: launchpad, data: call.data, value: "0xde0b6b3a7640000", chain_id: 10143 } },
    });
    // The key never travels; a signature over the request does.
    expect(JSON.stringify(request)).not.toContain(key.privateKey);
    const signature = request.headers["privy-authorization-signature"];
    expect(signature).toBeTruthy();

    // Privy verifies it over the canonical request with the quorum's public key; so does this.
    const payload = formatRequestForAuthorizationSignature({
      version: 1,
      method: "POST",
      url: request.url,
      body: request.body as Record<string, unknown>,
      headers: { "privy-app-id": "test-app-id", ...(request.headers["privy-request-expiry"] ? { "privy-request-expiry": request.headers["privy-request-expiry"] } : {}) },
    } as never);
    const publicKey = createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" });
    expect(verify("sha256", payload, publicKey, Buffer.from(signature, "base64"))).toBe(true);
  });
});
