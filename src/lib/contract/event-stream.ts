export const CONTRACT_EVENT_TOPICS = {
  initialized: "initialized",
  marketCreated: "market_created",
  poolFunded: "pool_funded",
  marketSettled: "market_settled",
  predictionCommitted: "prediction_committed",
  claimMissed: "claim_missed",
  claimPaid: "claim_paid",
} as const;

export type ContractEventTopic = (typeof CONTRACT_EVENT_TOPICS)[keyof typeof CONTRACT_EVENT_TOPICS];
export type ContractSyncReason = "startup" | "poll" | "visibility" | "online" | "queued";

export type ContractSyncContext = {
  reason: ContractSyncReason;
  topics: typeof CONTRACT_EVENT_TOPICS;
};

type TimerHandle = ReturnType<typeof setInterval>;

type EventStreamTarget = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

type VisibilityDocument = EventStreamTarget & {
  hidden?: boolean;
};

export type ContractEventStreamOptions = {
  pollMs: number;
  onSync(context: ContractSyncContext): Promise<void> | void;
  onError?: (error: unknown, context: ContractSyncContext) => void;
  setIntervalFn?: (handler: () => void, timeout: number) => TimerHandle;
  clearIntervalFn?: (handle: TimerHandle) => void;
  onlineTarget?: EventStreamTarget;
  visibilityDocument?: VisibilityDocument;
};

export function createContractEventStream(options: ContractEventStreamOptions) {
  const setIntervalFn = options.setIntervalFn ?? globalThis.setInterval.bind(globalThis);
  const clearIntervalFn = options.clearIntervalFn ?? globalThis.clearInterval.bind(globalThis);
  const onlineTarget = options.onlineTarget;
  const visibilityDocument = options.visibilityDocument;

  let active = false;
  let inFlight = false;
  let queued = false;
  let timer: TimerHandle | null = null;

  async function requestSync(reason: ContractSyncReason) {
    if (!active) return;
    if (inFlight) {
      queued = true;
      return;
    }

    const context: ContractSyncContext = { reason, topics: CONTRACT_EVENT_TOPICS };
    inFlight = true;
    try {
      await options.onSync(context);
    } catch (error) {
      options.onError?.(error, context);
    } finally {
      inFlight = false;
      if (queued && active) {
        queued = false;
        void requestSync("queued");
      }
    }
  }

  const handlePoll = () => {
    void requestSync("poll");
  };

  const handleOnline = () => {
    void requestSync("online");
  };

  const handleVisibility = () => {
    if (!visibilityDocument?.hidden) {
      void requestSync("visibility");
    }
  };

  return {
    start() {
      if (active) return;
      active = true;
      void requestSync("startup");
      timer = setIntervalFn(handlePoll, options.pollMs);
      onlineTarget?.addEventListener("online", handleOnline);
      visibilityDocument?.addEventListener("visibilitychange", handleVisibility);
    },
    stop() {
      if (!active) return;
      active = false;
      queued = false;
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
      onlineTarget?.removeEventListener("online", handleOnline);
      visibilityDocument?.removeEventListener("visibilitychange", handleVisibility);
    },
  };
}
