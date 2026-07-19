export const NETWORK_CONFIG = {
  contractId: import.meta.env.VITE_CONTRACT_ID ?? "CA7Q75QFMA6JOZEEVACJARFERWFKUYBVL4XCA6ATXMXGACWE5U55ZSOJ",
  marketId: 3003,
  network: "testnet",
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  maxRangeWidth: 1000,
  maxMultiplier: 10,
  minStakeXlm: 5,
  treasuryAddress: import.meta.env.VITE_TREASURY_ADDRESS ?? "GCU6JX2SBD2JUAWAH5U54VOU3KPXMJO2YMFPM5OZNZFDABWW3TVGP4GW",
} as const;
