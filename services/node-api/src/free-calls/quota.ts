import { consumeFreeCall, getFreeCallQuota } from "./repository.js";

export type FreeQuotaOperation = "similarity_analysis" | "staleness_reasoning";

export async function checkFreeQuotaAvailable(
  userId: string,
  _operation: FreeQuotaOperation | string,
): Promise<boolean> {
  const quota = await getFreeCallQuota(userId);
  return quota.remainingCalls > 0;
}

export async function consumeFreeQuota(
  userId: string,
  _operation: FreeQuotaOperation,
): Promise<boolean> {
  const decision = await consumeFreeCall(userId);
  return decision.allowed;
}

