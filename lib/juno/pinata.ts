/**
 * IPFS pinning via Pinata.
 *
 * Two jobs, both required for a token to be a real token:
 *
 *  - the media a creator uploads, and
 *  - the Metaplex metadata JSON the mint points at.
 *
 * Until this existed Juno launched with `uri: ""`, which is valid on-chain but
 * means every wallet and explorer renders the coin as an unnamed blank. The
 * mint is permanent; the URI it carries is set once at creation and cannot be
 * fixed later without update authority, which Juno's presets deliberately
 * renounce.
 */

const PINATA_API = "https://api.pinata.cloud";

/**
 * Deliberately a runtime guard rather than `server-only`.
 *
 * `server-only` throws at import time under any non-bundler runtime, which
 * would lock the CLI scripts out of the same pinning code the app uses — and
 * two implementations of "what metadata does a Juno token carry" is exactly
 * how they drift apart. This gives the same protection: `PINATA_JWT` has no
 * `NEXT_PUBLIC_` prefix so it is never bundled, and reaching this from a
 * browser fails loudly instead of silently sending an unauthenticated pin.
 */
function jwt(): string {
  if (typeof window !== "undefined") {
    throw new Error("Pinata must be called from the server, not the browser");
  }
  const token = process.env.PINATA_JWT;
  if (!token) throw new Error("PINATA_JWT is not set");
  return token;
}

export function ipfsGateway(): string {
  return (
    process.env.NEXT_PUBLIC_IPFS_GATEWAY?.replace(/\/$/, "") ??
    "https://gateway.pinata.cloud/ipfs"
  );
}

/** A gateway URL. Stored alongside the `ipfs://` form, never instead of it. */
export function gatewayUrl(cid: string): string {
  return `${ipfsGateway()}/${cid}`;
}

export type PinResult = { cid: string; uri: string; url: string };

function toResult(cid: string): PinResult {
  // `ipfs://` is the canonical address; the gateway URL is a convenience that
  // stops working if the gateway does, so both are kept.
  return { cid, uri: `ipfs://${cid}`, url: gatewayUrl(cid) };
}

export async function pinFile(file: File, name?: string): Promise<PinResult> {
  const form = new FormData();
  form.append("file", file, file.name || "upload");
  form.append("pinataMetadata", JSON.stringify({ name: name ?? file.name ?? "juno-media" }));

  const response = await fetch(`${PINATA_API}/pinning/pinFileToIPFS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt()}` },
    body: form,
  });

  if (!response.ok) {
    throw new Error(`Pinata upload failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { IpfsHash: string };
  return toResult(body.IpfsHash);
}

export async function pinJson(content: unknown, name: string): Promise<PinResult> {
  const response = await fetch(`${PINATA_API}/pinning/pinJSONToIPFS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt()}`, "content-type": "application/json" },
    body: JSON.stringify({ pinataContent: content, pinataMetadata: { name } }),
  });

  if (!response.ok) {
    throw new Error(`Pinata JSON pin failed (${response.status}): ${await response.text()}`);
  }
  const body = (await response.json()) as { IpfsHash: string };
  return toResult(body.IpfsHash);
}

/**
 * Token metadata, in the de facto JSON shape wallets and explorers read.
 *
 * `JunoToken.tokenURI` points at this document forever, so it follows the
 * common `name / symbol / description / image / attributes` layout rather than
 * an ad-hoc object, and wallets and explorers render the coin without
 * special-casing.
 */
export type TokenMetadataInput = {
  name: string;
  symbol: string;
  description?: string;
  /** Gateway URL of the already-pinned media. */
  imageUrl?: string;
  mediaMimeType?: string;
  externalUrl?: string;
  /** Curve preset and NAV feed, so the config travels with the token. */
  attributes?: Array<{ trait_type: string; value: string }>;
};

export async function pinTokenMetadata(input: TokenMetadataInput): Promise<PinResult> {
  const category = input.mediaMimeType?.startsWith("video") ? "video" : "image";

  const metadata = {
    name: input.name,
    symbol: input.symbol,
    description: input.description ?? "",
    image: input.imageUrl ?? "",
    external_url: input.externalUrl ?? "",
    attributes: input.attributes ?? [],
    properties: {
      category,
      files: input.imageUrl
        ? [{ uri: input.imageUrl, type: input.mediaMimeType ?? "image/png" }]
        : [],
    },
  };

  return pinJson(metadata, `juno-${input.symbol}-metadata`);
}
