import { useCallback, useEffect, useMemo, useState } from "react";

import {
  connectWallet as defaultConnectWallet,
  getWalletAddress as defaultGetWalletAddress,
  signTx as defaultSignTx,
} from "@/lib/stellar-wallet";
import { buildPaymentXdr, fetchXlmBalance, submitSignedTx } from "@/lib/stellar-sdk";

type WalletAdapters = {
  connectWallet?: typeof defaultConnectWallet;
  getWalletAddress?: typeof defaultGetWalletAddress;
  signTx?: typeof defaultSignTx;
};

type WalletState = {
  address: string | null;
  balance: string;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
};

type WalletLoadingAction = "initializing" | "connecting" | "refreshing" | "sending" | null;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return fallback;
}

export function useWallet(adapters: WalletAdapters = {}) {
  const walletApi = useMemo(
    () => ({
      connectWallet: adapters.connectWallet ?? defaultConnectWallet,
      getWalletAddress: adapters.getWalletAddress ?? defaultGetWalletAddress,
      signTx: adapters.signTx ?? defaultSignTx,
    }),
    [adapters.connectWallet, adapters.getWalletAddress, adapters.signTx],
  );

  const [state, setState] = useState<WalletState>({
    address: null,
    balance: "0 XLM",
    isConnected: false,
    isLoading: true,
    error: null,
  });
  const [loadingAction, setLoadingAction] = useState<WalletLoadingAction>("initializing");

  const loadBalance = useCallback(async (walletAddress: string) => {
    const balance = await fetchXlmBalance(walletAddress);
    setState((current) => ({ ...current, balance, error: null }));
    return balance;
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function restoreWallet() {
      setLoadingAction("initializing");
      setState((current) => ({ ...current, isLoading: true, error: null }));

      try {
        const walletAddress = await walletApi.getWalletAddress();

        if (!isMounted) {
          return;
        }

        if (!walletAddress) {
          setState({
            address: null,
            balance: "0 XLM",
            isConnected: false,
            isLoading: false,
            error: null,
          });
          return;
        }

        setState((current) => ({
          ...current,
          address: walletAddress,
          isConnected: true,
          isLoading: false,
          error: null,
        }));

        await loadBalance(walletAddress);
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setState({
          address: null,
          balance: "0 XLM",
          isConnected: false,
          isLoading: false,
          error: getErrorMessage(error, "Unable to restore Freighter wallet."),
        });
      } finally {
        if (isMounted) {
          setLoadingAction(null);
          setState((current) => ({ ...current, isLoading: false }));
        }
      }
    }

    void restoreWallet();

    return () => {
      isMounted = false;
    };
  }, [loadBalance, walletApi]);

  const connect = useCallback(async () => {
    setLoadingAction("connecting");
    setState((current) => ({ ...current, isLoading: true, error: null }));

    try {
      const walletAddress = await walletApi.connectWallet();
      setState((current) => ({
        ...current,
        address: walletAddress,
        isConnected: true,
        isLoading: false,
        error: null,
      }));
      await loadBalance(walletAddress);
      return walletAddress;
    } catch (error) {
      const message = getErrorMessage(error, "Unable to connect Freighter.");
      setState((current) => ({ ...current, isLoading: false, error: message }));
      throw new Error(message);
    } finally {
      setLoadingAction(null);
      setState((current) => ({ ...current, isLoading: false }));
    }
  }, [loadBalance, walletApi]);

  const disconnect = useCallback(() => {
    setLoadingAction(null);
    setState({
      address: null,
      balance: "0 XLM",
      isConnected: false,
      isLoading: false,
      error: null,
    });
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!state.address) {
      const message = "Connect Freighter before refreshing the balance.";
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    }

    setLoadingAction("refreshing");
    setState((current) => ({ ...current, isLoading: true, error: null }));

    try {
      return await loadBalance(state.address);
    } catch (error) {
      const message = getErrorMessage(error, "Unable to refresh XLM balance.");
      setState((current) => ({ ...current, error: message }));
      throw new Error(message);
    } finally {
      setLoadingAction(null);
      setState((current) => ({ ...current, isLoading: false }));
    }
  }, [loadBalance, state.address]);

  const sendXlm = useCallback(
    async (to: string, amount: string): Promise<{ hash: string }> => {
      if (!state.address) {
        const message = "Connect Freighter before sending XLM.";
        setState((current) => ({ ...current, error: message }));
        throw new Error(message);
      }

      setLoadingAction("sending");
      setState((current) => ({ ...current, isLoading: true, error: null }));

      try {
        const xdr = await buildPaymentXdr(state.address, to, amount);
        const signedXdr = await walletApi.signTx(xdr);
        const result = await submitSignedTx(signedXdr);
        await loadBalance(state.address);
        return result;
      } catch (error) {
        const message = getErrorMessage(error, "Unable to send XLM.");
        setState((current) => ({ ...current, error: message }));
        throw new Error(message);
      } finally {
        setLoadingAction(null);
        setState((current) => ({ ...current, isLoading: false }));
      }
    },
    [loadBalance, state.address, walletApi],
  );

  return {
    ...state,
    loadingAction,
    connect,
    disconnect,
    refreshBalance,
    sendXlm,
  };
}
