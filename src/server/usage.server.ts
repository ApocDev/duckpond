import { z } from "zod";
import { listProviderUsage } from "./store.server";
import { usageRecordSchema } from "./sessions.server";
import { requireAllowedRequest } from "./access.server";

type UsageRecord = z.infer<typeof usageRecordSchema>;
function totals(records: UsageRecord[]) {
  return {
    calls: records.length,
    resumedCalls: records.filter((record) => record.resumed).length,
    complete: records.filter((record) => record.status === "complete").length,
    failed: records.filter((record) => record.status === "error").length,
    stopped: records.filter((record) => record.status === "stopped").length,
    unfinished: records.filter((record) => record.status === "running").length,
    callsWithReportedTokens: records.filter((record) => record.tokens !== null).length,
    inputTokens: records.reduce((sum, record) => sum + (record.tokens?.input ?? 0), 0),
    outputTokens: records.reduce((sum, record) => sum + (record.tokens?.output ?? 0), 0),
    cacheReadTokens: records.reduce((sum, record) => sum + (record.tokens?.cacheRead ?? 0), 0),
    cacheWriteTokens: records.reduce((sum, record) => sum + (record.tokens?.cacheWrite ?? 0), 0),
    reasoningTokens: records.reduce((sum, record) => sum + (record.tokens?.reasoning ?? 0), 0),
    callsWithCacheWriteCounts: records.filter((record) => record.tokens?.cacheWrite != null).length,
    callsWithReasoningCounts: records.filter((record) => record.tokens?.reasoning != null).length,
  };
}
export function usageReport(records: UsageRecord[]) {
  const groups = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key = JSON.stringify([
      record.roomId,
      record.duckId,
      record.provider,
      record.model,
      record.reasoning,
    ]);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return {
    trackedSince: records.at(0)?.startedAt ?? null,
    notes: [
      "Input includes cached input. Cache reads and writes are subsets of input, not additional tokens.",
      "Reasoning tokens are part of output. Missing provider counts remain null on individual calls.",
      "Counts include native tool steps when reported by the provider. Failed or interrupted calls may have incomplete counts.",
      "Subscription allowances and charges cannot be inferred from these token counts. Earlier calls are not backfilled.",
      "Unfinished calls may still be running or may have been interrupted by a server restart.",
    ],
    totals: totals(records),
    breakdown: [...groups.values()].map((group) => ({
      roomId: group[0].roomId,
      duckId: group[0].duckId,
      duckName: group.at(-1)!.duckName,
      provider: group[0].provider,
      model: group[0].model,
      reasoning: group[0].reasoning,
      ...totals(group),
    })),
  };
}

/** Read-only report. Filters apply to totals and the optional per-call audit. */
export function usageResponse(request: Request) {
  requireAllowedRequest(request);
  const query = new URL(request.url).searchParams;
  const records = listProviderUsage()
    .map((record) => usageRecordSchema.parse(record))
    .filter(
      (record) =>
        (!query.has("roomId") || record.roomId === query.get("roomId")) &&
        (!query.has("provider") || record.provider === query.get("provider")),
    );
  return new Response(
    JSON.stringify(
      { ...usageReport(records), ...(query.get("calls") === "1" ? { calls: records } : {}) },
      null,
      2,
    ),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
}
