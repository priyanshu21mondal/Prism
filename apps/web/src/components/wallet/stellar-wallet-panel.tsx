"use client";

import { FormEvent, useEffect, useState } from "react";

import { detectFreighter, connectWallet, signTx } from "@/lib/stellar-wallet";
import { HORIZON_TESTNET_URL, STELLAR_TESTNET_PASSPHRASE } from "@/lib/stellar-wallet";
import { useWallet } from "@/hooks/use-stellar-wallet";

type DetectionState = "checking" | "installed" | "missing" | "error";

type TransactionBanner =
  | { kind: "success"; hash: string }
  | { kind: "error"; message: string }
  | null;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return fallback;
}

export function StellarWalletPanel() {
  const [detectionState, setDetectionState] = useState<DetectionState>("checking");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionBanner, setTransactionBanner] = useState<TransactionBanner>(null);
  const wallet = useWallet({ connectWallet, signTx });

  useEffect(() => {
    let isMounted = true;

    async function checkFreighter() {
      setDetectionState("checking");

      try {
        const installed = await detectFreighter();

        if (isMounted) {
          setDetectionState(installed ? "installed" : "missing");
        }
      } catch {
        if (isMounted) {
          setDetectionState("error");
        }
      }
    }

    void checkFreighter();

    return () => {
      isMounted = false;
    };
  }, []);

  async function handleConnect() {
    setTransactionBanner(null);

    try {
      await wallet.connect();
    } catch (error) {
      setTransactionBanner({ kind: "error", message: getErrorMessage(error, "Unable to connect wallet.") });
    }
  }

  async function handleRefreshBalance() {
    setTransactionBanner(null);

    try {
      await wallet.refreshBalance();
    } catch (error) {
      setTransactionBanner({ kind: "error", message: getErrorMessage(error, "Unable to refresh balance.") });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransactionBanner(null);

    try {
      const result = await wallet.sendXlm(destination.trim(), amount.trim());
      setTransactionBanner({ kind: "success", hash: result.hash });
      setDestination("");
      setAmount("");
    } catch (error) {
      setTransactionBanner({ kind: "error", message: getErrorMessage(error, "Unable to send XLM.") });
    }
  }

  const isConnecting = wallet.loadingAction === "connecting";
  const isRefreshing = wallet.loadingAction === "refreshing";
  const isSending = wallet.loadingAction === "sending";
  const isInitializing = wallet.loadingAction === "initializing";
  const canConnect = detectionState === "installed" && !wallet.isConnected;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 text-slate-950">
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">Stellar TESTNET wallet setup</p>
        <h1 className="text-3xl font-semibold">Stellar Wallet - Freighter Integration</h1>
        <p className="text-sm text-slate-600">
          Horizon: <span className="font-mono">{HORIZON_TESTNET_URL}</span>
        </p>
        <p className="text-sm text-slate-600">
          Network passphrase: <span className="font-mono">{STELLAR_TESTNET_PASSPHRASE}</span>
        </p>
      </div>

      <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">1. Detect Freighter</h2>
            <p className="text-sm text-slate-600">
              Status:{" "}
              <span className="font-semibold">
                {detectionState === "checking"
                  ? "Checking extension..."
                  : detectionState === "installed"
                    ? "Freighter detected"
                    : detectionState === "missing"
                      ? "Freighter not detected"
                      : "Detection failed"}
              </span>
            </p>
          </div>

          {detectionState === "missing" || detectionState === "error" ? (
            <a
              className="inline-flex items-center justify-center rounded border border-sky-700 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50"
              href="https://freighter.app"
              rel="noreferrer"
              target="_blank"
            >
              Install Freighter
            </a>
          ) : null}
        </div>
      </div>

      <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">2. Connect Wallet</h2>
              <p className="text-sm text-slate-600">Connect with Freighter requestAccess(), then display the full G-address.</p>
            </div>

            {wallet.isConnected ? (
              <button
                className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                onClick={() => {
                  setTransactionBanner(null);
                  wallet.disconnect();
                }}
                type="button"
              >
                Disconnect
              </button>
            ) : (
              <button
                className="rounded bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={!canConnect || isConnecting || isInitializing}
                onClick={handleConnect}
                type="button"
              >
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
            )}
          </div>

          {wallet.address ? (
            <div className="break-all rounded border border-slate-200 bg-slate-50 p-3 font-mono text-sm">{wallet.address}</div>
          ) : null}
        </div>
      </div>

      {wallet.isConnected ? (
        <>
          <div className="rounded border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">3. XLM Balance</h2>
                <p className="mt-2 text-4xl font-semibold text-sky-800">{wallet.balance}</p>
              </div>

              <button
                className="rounded border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                disabled={isRefreshing || wallet.isLoading}
                onClick={handleRefreshBalance}
                type="button"
              >
                {isRefreshing ? "Refreshing..." : "Refresh Balance"}
              </button>
            </div>
          </div>

          <form className="rounded border border-slate-200 bg-white p-5 shadow-sm" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">4. Send XLM</h2>
              <p className="text-sm text-slate-600">Build on Stellar SDK, sign with Freighter, then submit to Horizon testnet.</p>
            </div>

            <label className="mt-5 block text-sm font-semibold" htmlFor="stellar-destination">
              Destination address
            </label>
            <input
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-sky-700"
              id="stellar-destination"
              onChange={(event) => setDestination(event.target.value)}
              placeholder="G..."
              required
              value={destination}
            />

            <label className="mt-4 block text-sm font-semibold" htmlFor="stellar-amount">
              Amount (XLM)
            </label>
            <input
              className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-700"
              id="stellar-amount"
              min="0.0000001"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="12.5"
              required
              step="0.0000001"
              type="number"
              value={amount}
            />

            <button
              className="mt-5 rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-400"
              disabled={isSending || wallet.isLoading}
              type="submit"
            >
              {isSending ? "Sending..." : "Send XLM"}
            </button>
          </form>
        </>
      ) : null}

      {wallet.error ? <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">{wallet.error}</div> : null}

      {transactionBanner?.kind === "success" ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          Transaction sent! Hash:{" "}
          <a
            className="break-all underline"
            href={`https://stellar.expert/explorer/testnet/tx/${transactionBanner.hash}`}
            rel="noreferrer"
            target="_blank"
          >
            {transactionBanner.hash}
          </a>
        </div>
      ) : null}

      {transactionBanner?.kind === "error" ? (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{transactionBanner.message}</div>
      ) : null}
    </section>
  );
}
