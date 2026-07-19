import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_EVENT_TOPICS, createContractEventStream, type ContractSyncReason } from "./event-stream.ts";

function createTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, listener: () => void) {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("documents contract event topics consumed by the frontend", () => {
  assert.deepEqual(Object.values(CONTRACT_EVENT_TOPICS), [
    "initialized",
    "market_created",
    "pool_funded",
    "market_settled",
    "prediction_committed",
    "claim_missed",
    "claim_paid",
  ]);
});

test("runs startup and polling synchronization", async () => {
  const intervals: Array<() => void> = [];
  const reasons: ContractSyncReason[] = [];
  const stream = createContractEventStream({
    pollMs: 10_000,
    onSync: ({ reason }) => reasons.push(reason),
    setIntervalFn: (handler) => {
      intervals.push(handler);
      return intervals.length;
    },
    clearIntervalFn: () => undefined,
  });

  stream.start();
  await flush();
  intervals[0]();
  await flush();

  assert.deepEqual(reasons, ["startup", "poll"]);
});

test("resynchronizes after reconnect and removes listeners on stop", async () => {
  const onlineTarget = createTarget();
  const visibilityDocument = { ...createTarget(), hidden: false };
  const reasons: ContractSyncReason[] = [];
  const stream = createContractEventStream({
    pollMs: 10_000,
    onSync: ({ reason }) => reasons.push(reason),
    setIntervalFn: () => 1,
    clearIntervalFn: () => undefined,
    onlineTarget,
    visibilityDocument,
  });

  stream.start();
  await flush();
  onlineTarget.dispatch("online");
  visibilityDocument.dispatch("visibilitychange");
  await flush();
  stream.stop();
  onlineTarget.dispatch("online");
  visibilityDocument.dispatch("visibilitychange");
  await flush();

  assert.deepEqual(reasons, ["startup", "online", "queued"]);
  assert.equal(onlineTarget.listenerCount("online"), 0);
  assert.equal(visibilityDocument.listenerCount("visibilitychange"), 0);
});
