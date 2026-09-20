/**
 * Stellar Wallets Kit adapter (W4a).
 *
 * This is the only module that imports Wallets Kit. It is reachable solely from
 * the bridge entry, so the desktop app's bundle never grows by it.
 *
 * Freighter is the only module shipped: the task is a one-shot sign of one
 * specific XDR, and a single known wallet keeps the surface (and the bundle)
 * small. `fetchAddress` is what opens Freighter's access prompt.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import type { Networks } from "@creit.tech/stellar-wallets-kit/types";

import type { BridgeWallet } from "./signFlow.ts";

export function createFreighterWallet(): BridgeWallet {
  let initialized = false;

  const ensureInit = (networkPassphrase: string): void => {
    if (initialized) {
      StellarWalletsKit.setNetwork(networkPassphrase as Networks);
      return;
    }
    StellarWalletsKit.init({
      modules: [new FreighterModule()],
      selectedWalletId: FREIGHTER_ID,
      network: networkPassphrase as Networks,
    });
    initialized = true;
  };

  return {
    async connect({ networkPassphrase }) {
      ensureInit(networkPassphrase);
      const { address } = await StellarWalletsKit.fetchAddress();
      return { address };
    },

    async signTransaction(xdr, { networkPassphrase, address }) {
      const { signedTxXdr, signerAddress } = await StellarWalletsKit.signTransaction(xdr, {
        networkPassphrase,
        address,
      });
      return { signedXdr: signedTxXdr, signerAddress };
    },

    async getNetwork() {
      const { networkPassphrase } = await StellarWalletsKit.getNetwork();
      return { networkPassphrase };
    },
  };
}
