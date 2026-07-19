import { Asset, BASE_FEE, Horizon, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";

import { HORIZON_TESTNET_URL, STELLAR_TESTNET_PASSPHRASE } from "@/lib/stellar-wallet";

const server = new Horizon.Server(HORIZON_TESTNET_URL);

type HorizonErrorBody = {
  title?: string;
  detail?: string;
  extras?: {
    result_codes?: {
      transaction?: string;
      operations?: string[];
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return fallback;
}

async function parseHorizonError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as HorizonErrorBody;
    const operationCodes = body.extras?.result_codes?.operations?.join(", ");
    const transactionCode = body.extras?.result_codes?.transaction;
    const codeSummary = [transactionCode, operationCodes].filter(Boolean).join(" / ");
    return [body.title, body.detail, codeSummary].filter(Boolean).join(": ") || `Horizon request failed (${response.status}).`;
  } catch {
    return `Horizon request failed (${response.status}).`;
  }
}

function validatePaymentInput(from: string, to: string, amount: string): void {
  if (!StrKey.isValidEd25519PublicKey(from)) {
    throw new Error("Source address must be a valid Stellar G-address.");
  }

  if (!StrKey.isValidEd25519PublicKey(to)) {
    throw new Error("Destination address must be a valid Stellar G-address.");
  }

  const numericAmount = Number(amount);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error("Amount must be a positive XLM number.");
  }
}

export async function fetchXlmBalance(address: string): Promise<string> {
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new Error("Wallet address must be a valid Stellar G-address.");
  }

  const response = await fetch(`${HORIZON_TESTNET_URL}/accounts/${address}`);

  if (response.status === 404) {
    return "0 XLM (account not funded)";
  }

  if (!response.ok) {
    throw new Error(await parseHorizonError(response));
  }

  const account = (await response.json()) as Horizon.HorizonApi.AccountResponse;
  const nativeBalance = account.balances.find((balance) => balance.asset_type === "native");

  return `${nativeBalance?.balance ?? "0.0000000"} XLM`;
}

export async function buildPaymentXdr(from: string, to: string, amount: string): Promise<string> {
  validatePaymentInput(from, to, amount);

  try {
    const account = await server.loadAccount(from);
    const fee = await server.fetchBaseFee().catch(() => Number(BASE_FEE));

    const transaction = new TransactionBuilder(account, {
      fee: fee.toString(),
      networkPassphrase: STELLAR_TESTNET_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: to,
          asset: Asset.native(),
          amount,
        }),
      )
      .setTimeout(30)
      .build();

    return transaction.toXDR();
  } catch (error) {
    throw new Error(errorMessage(error, "Unable to build the XLM payment transaction."));
  }
}

export async function submitSignedTx(signedXdr: string): Promise<{ hash: string }> {
  try {
    const transaction = TransactionBuilder.fromXDR(signedXdr, STELLAR_TESTNET_PASSPHRASE);
    const response = await server.submitTransaction(transaction);
    return { hash: response.hash };
  } catch (error) {
    throw new Error(errorMessage(error, "Horizon rejected the signed transaction."));
  }
}
