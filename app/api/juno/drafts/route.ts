import { CallerError, junoHandler, junoJson, junoOptions, readJson, requireString } from "@/lib/juno/api";
import { deleteDraft, listDrafts, saveDraft } from "@/lib/juno/drafts";

export const dynamic = "force-dynamic";
export const OPTIONS = junoOptions;

/** `GET ?wallet=` — a wallet's sealed drafts: opaque Mera vaults, newest first. */
export async function GET(request: Request) {
  return junoHandler(async () => {
    const wallet = new URL(request.url).searchParams.get("wallet");
    if (!wallet) throw new CallerError("wallet is required");
    return junoJson({ drafts: await listDrafts(wallet) });
  });
}

/** `POST {wallet, vault, issuedAt, signature}` — store a sealed draft; `vault` is the vault's JSON text, signed as sent. */
export async function POST(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    const draft = await saveDraft({
      wallet: requireString(body.wallet, "wallet"),
      vault: requireString(body.vault, "vault"),
      issuedAt: requireString(body.issuedAt, "issuedAt"),
      signature: requireString(body.signature, "signature"),
    });
    return junoJson({ draft }, { status: 201 });
  });
}

/** `DELETE {wallet, id, issuedAt, signature}` — remove one, signed by its wallet. */
export async function DELETE(request: Request) {
  return junoHandler(async () => {
    const body = await readJson<Record<string, unknown>>(request);
    return junoJson(
      await deleteDraft({
        wallet: requireString(body.wallet, "wallet"),
        id: requireString(body.id, "id"),
        issuedAt: requireString(body.issuedAt, "issuedAt"),
        signature: requireString(body.signature, "signature"),
      }),
    );
  });
}
