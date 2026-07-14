import { validateStartupSummary, type StartupSummary } from "./startup-contracts";

export const startupHistorySchemaVersion = "velox.startup-history/v1" as const;
export const maximumHistoryPoints = 12;

export type StartupHistoryCandidate = {
  runId: string;
  runAttempt: number;
  benchmarkCommit: string;
  createdAtUtc: string;
  summary: StartupSummary;
};

export type StartupHistoryIssue = {
  runId: string;
  code: "ARTIFACT_MISSING" | "ARTIFACT_DOWNLOAD_FAILED" | "SUMMARY_INVALID";
};

export type StartupHistory = {
  schemaVersion: typeof startupHistorySchemaVersion;
  suite: "velox-startup";
  outcome: "complete" | "partial";
  generatedAtUtc: string;
  points: StartupHistoryCandidate[];
  series: Array<{ environmentKey: string; runIds: string[] }>;
  collectionIssues: StartupHistoryIssue[];
};

export function buildStartupHistory(candidates: StartupHistoryCandidate[], issues: StartupHistoryIssue[], generatedAtUtc: string): StartupHistory {
  if (!Number.isFinite(Date.parse(generatedAtUtc))) throw new Error("invalid history generation timestamp");
  const byRun = new Map<string, StartupHistoryCandidate>();
  for (const candidate of candidates) {
    validateStartupSummary(candidate.summary);
    if (!/^[0-9]+$/.test(candidate.runId) || !Number.isInteger(candidate.runAttempt) || candidate.runAttempt < 1 ||
        !/^[0-9a-f]{40}$/.test(candidate.benchmarkCommit) || !Number.isFinite(Date.parse(candidate.createdAtUtc))) {
      throw new Error(`invalid startup history candidate ${candidate.runId}`);
    }
    const existing = byRun.get(candidate.runId);
    if (!existing || candidate.runAttempt > existing.runAttempt) byRun.set(candidate.runId, candidate);
  }
  const points = [...byRun.values()]
    .sort((left, right) => Date.parse(left.createdAtUtc) - Date.parse(right.createdAtUtc) || Number(left.runId) - Number(right.runId))
    .slice(-maximumHistoryPoints);
  const seriesMap = new Map<string, string[]>();
  for (const point of points) {
    for (const group of point.summary.environmentGroups) {
      const runIds = seriesMap.get(group.key) ?? [];
      runIds.push(point.runId);
      seriesMap.set(group.key, runIds);
    }
  }
  const series = [...seriesMap.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([environmentKey, runIds]) => ({ environmentKey, runIds }));
  const collectionIssues = [...issues].sort((left, right) => Number(left.runId) - Number(right.runId) || left.code.localeCompare(right.code));
  return {
    schemaVersion: startupHistorySchemaVersion,
    suite: "velox-startup",
    outcome: collectionIssues.length === 0 ? "complete" : "partial",
    generatedAtUtc,
    points,
    series,
    collectionIssues,
  };
}
