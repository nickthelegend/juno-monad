import type { WebAuthnClient } from "@category-labs/mera";

/**
 * The web build's WebAuthn client for Mera: Mera's own browser client, line
 * for line (same options, same PRF handling), plus one thing Mera does not
 * keep: the new passkey's public key, from `getPublicKey()` at creation. It
 * is not secret, and it is what lets Monad's P256 precompile check this
 * passkey's signatures later (lib/mera.ts `assertMeraPasskey`). iOS and
 * Android resolve `mera-client.native.ts` instead.
 */
let createdKey: Uint8Array | null = null;

/** The public key (SPKI DER) of the passkey just created, once; null if none was captured. */
export function takeCreatedPublicKey(): Uint8Array | null {
  const key = createdKey;
  createdKey = null;
  return key;
}

function bytes(value: BufferSource | undefined): Uint8Array | undefined {
  if (!value) return undefined;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };

function asCredential(credential: Credential | null): PublicKeyCredential {
  if (!credential || credential.type !== "public-key" || !("rawId" in credential)) {
    throw Object.assign(new Error("WebAuthn returned no usable public key credential"), { code: "PASSKEY_OPERATION_FAILED" });
  }
  return credential as PublicKeyCredential;
}

const capturingClient: WebAuthnClient = {
  async createCredential(request) {
    const credential = asCredential(
      (await globalThis.navigator?.credentials?.create({
        publicKey: {
          rp: request.rp,
          user: request.user,
          challenge: request.challenge,
          pubKeyCredParams: request.algorithms.map((alg) => ({ type: "public-key" as const, alg })),
          ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
          attestation: request.attestation,
          authenticatorSelection: { residentKey: request.residentKey, requireResidentKey: true, userVerification: request.userVerification },
          extensions: { prf: { eval: { first: request.prfSalt } } } as AuthenticationExtensionsClientInputs,
        },
      })) ?? null,
    );
    const response = credential.response as AuthenticatorAttestationResponse;
    const spki = typeof response.getPublicKey === "function" ? response.getPublicKey() : null;
    createdKey = spki ? new Uint8Array(spki) : null;
    const prf = (credential.getClientExtensionResults() as PrfResults).prf;
    const transports = typeof response.getTransports === "function" ? response.getTransports() : undefined;
    const first = bytes(prf?.results?.first);
    return {
      credentialId: new Uint8Array(credential.rawId),
      ...(transports !== undefined ? { transports } : {}),
      prfEnabled: prf?.enabled === true,
      ...(first ? { prfOutput: new Uint8Array(first) } : {}),
    } as Awaited<ReturnType<WebAuthnClient["createCredential"]>>;
  },
  async getCredential(request) {
    const { allowCredential } = request;
    const credential = asCredential(
      (await globalThis.navigator?.credentials?.get({
        publicKey: {
          rpId: request.rpId,
          challenge: request.challenge,
          ...(request.timeout !== undefined ? { timeout: request.timeout } : {}),
          userVerification: request.userVerification,
          extensions: { prf: { eval: { first: request.prfSalt } } } as AuthenticationExtensionsClientInputs,
          ...(allowCredential !== undefined
            ? {
                allowCredentials: [
                  {
                    id: allowCredential.credentialId,
                    type: "public-key" as const,
                    ...(allowCredential.transports !== undefined ? { transports: allowCredential.transports as AuthenticatorTransport[] } : {}),
                  },
                ],
              }
            : {}),
        },
      })) ?? null,
    );
    const first = bytes((credential.getClientExtensionResults() as PrfResults).prf?.results?.first);
    return {
      credentialId: new Uint8Array(credential.rawId),
      ...(first ? { prfOutput: new Uint8Array(first) } : {}),
    } as Awaited<ReturnType<WebAuthnClient["getCredential"]>>;
  },
};

export const webAuthnClient: WebAuthnClient | undefined = capturingClient;

export function passkeysSupported(): boolean {
  return typeof globalThis.PublicKeyCredential !== "undefined" && Boolean(globalThis.navigator?.credentials);
}

/**
 * A plain WebAuthn assertion over `challenge` by one known passkey: what
 * Monad's P256 precompile checks. No PRF here; this proves the passkey signed.
 */
export async function assertPasskey(input: { rpId: string; credentialId: Uint8Array; challenge: Uint8Array }) {
  const credential = asCredential(
    (await globalThis.navigator?.credentials?.get({
      publicKey: {
        rpId: input.rpId,
        challenge: input.challenge as BufferSource,
        userVerification: "required",
        allowCredentials: [{ id: input.credentialId as BufferSource, type: "public-key" }],
      },
    })) ?? null,
  );
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
    signature: new Uint8Array(response.signature),
  };
}
