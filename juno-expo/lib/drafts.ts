import { sha256, stringToBytes } from "viem";

import { api } from "./api";
import { openSecret, sealSecret } from "./mera";
import type { WalletState } from "./wallet";

/**
 * Sealed drafts: a post's words, encrypted to the creator's passkey with
 * Mera, kept on Juno's server as ciphertext, opened on any device with the
 * same passkey. The server stores vaults it cannot read; writes are signed by
 * the wallet (no prompt while a signing session is open).
 */

export type DraftContent = { kind: "post" | "reel"; name: string; symbol: string; caption: string };
export type SealedDraft = { id: string; createdAt: string; vault: string };

/** Must match `sealDraftMessage` on the server, character for character. */
function sealMessage(wallet: string, vaultJson: string, issuedAt: string): string {
  return `Juno sealed draft\nWallet: ${wallet}\nVault: ${sha256(stringToBytes(vaultJson))}\nIssued: ${issuedAt}`;
}

function deleteMessage(wallet: string, id: string, issuedAt: string): string {
  return `Juno delete sealed draft\nWallet: ${wallet}\nDraft: ${id}\nIssued: ${issuedAt}`;
}

export function listDrafts(wallet: string) {
  return api.get<{ drafts: SealedDraft[] }>(`/api/juno/drafts?wallet=${wallet}`);
}

export async function sealDraft(wallet: WalletState, content: DraftContent) {
  if (!wallet.address) throw new Error("No wallet");
  const vault = await sealSecret(stringToBytes(JSON.stringify(content)));
  const issuedAt = new Date().toISOString();
  const signature = await wallet.signMessage(sealMessage(wallet.address, vault, issuedAt));
  return api.post<{ draft: { id: string; createdAt: string } }>("/api/juno/drafts", {
    wallet: wallet.address,
    vault,
    issuedAt,
    signature,
  });
}

export async function openDraft(draft: SealedDraft): Promise<DraftContent> {
  const bytes = await openSecret(draft.vault);
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<DraftContent>;
  return {
    kind: parsed.kind === "reel" ? "reel" : "post",
    name: String(parsed.name ?? ""),
    symbol: String(parsed.symbol ?? ""),
    caption: String(parsed.caption ?? ""),
  };
}

export async function deleteDraft(wallet: WalletState, id: string) {
  if (!wallet.address) throw new Error("No wallet");
  const issuedAt = new Date().toISOString();
  const signature = await wallet.signMessage(deleteMessage(wallet.address, id, issuedAt));
  return api.del<{ deleted: string }>("/api/juno/drafts", { wallet: wallet.address, id, issuedAt, signature });
}
