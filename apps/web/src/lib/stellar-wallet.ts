import { getAddress, isAllowed, isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";

export const HORIZON_TESTNET_URL = "https://horizon-testnet.stellar.org";
export const STELLAR_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function freighterErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return fallback;
}

export async function detectFreighter(): Promise<boolean> {
  const result = await isConnected();

  if (result.error) {
    throw new Error(freighterErrorMessage(result.error, "Unable to detect Freighter."));
  }

  return result.isConnected;
}

export async function connectWallet(): Promise<string> {
  const allowed = await isAllowed();

  if (allowed.error) {
    throw new Error(freighterErrorMessage(allowed.error, "Unable to read Freighter permission state."));
  }

  const access = await requestAccess();

  if (access.error || !access.address) {
    throw new Error(freighterErrorMessage(access.error, "Freighter access was rejected."));
  }

  const address = await getAddress();

  if (address.error || !address.address) {
    throw new Error(freighterErrorMessage(address.error, "Freighter did not return a wallet address."));
  }

  return address.address;
}

export async function getWalletAddress(): Promise<string | null> {
  const allowed = await isAllowed();

  if (allowed.error) {
    throw new Error(freighterErrorMessage(allowed.error, "Unable to read Freighter permission state."));
  }

  if (!allowed.isAllowed) {
    return null;
  }

  const address = await getAddress();

  if (address.error) {
    throw new Error(freighterErrorMessage(address.error, "Unable to read Freighter wallet address."));
  }

  return address.address || null;
}

export async function signTx(xdr: string): Promise<string> {
  const signed = await signTransaction(xdr, {
    networkPassphrase: STELLAR_TESTNET_PASSPHRASE,
  });

  if (signed.error || !signed.signedTxXdr) {
    throw new Error(freighterErrorMessage(signed.error, "Freighter could not sign the transaction."));
  }

  return signed.signedTxXdr;
}
