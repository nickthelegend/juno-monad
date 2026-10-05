/**
 * The address the Agent Wallet will sign with, from its state snapshot.
 *
 * Juno builds each trade for one address: it pays out to it and spends from
 * it. So the plugin asks for the wallet the person selected (`selectedWallet`
 * names it by reference), and falls back to the first EVM wallet, as
 * MetaMask's own sample plugin does.
 */

type Record_ = { address?: string; id?: string; namespace?: string };
type Snapshot = {
  selectedWallet?: { ref?: unknown; namespace?: string } | null;
  byokWallets?: Record_[];
  remoteWallets?: Record_[];
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function activeAddress(snapshot: Snapshot): string | null {
  const wallets = [...(snapshot.byokWallets ?? []), ...(snapshot.remoteWallets ?? [])].filter(
    (wallet) => typeof wallet.address === "string" && ADDRESS.test(wallet.address) && (!wallet.namespace || wallet.namespace === "evm"),
  );
  const ref = snapshot.selectedWallet?.ref;
  if (typeof ref === "string") {
    if (ADDRESS.test(ref)) return ref;
    const byId = wallets.find((wallet) => wallet.id === ref);
    if (byId?.address) return byId.address;
  } else if (ref && typeof ref === "object") {
    const { address, id } = ref as Record_;
    if (address && ADDRESS.test(address)) return address;
    const byId = wallets.find((wallet) => wallet.id === id);
    if (byId?.address) return byId.address;
  }
  return wallets[0]?.address ?? null;
}
