import { createHash } from "node:crypto";
import type { PairDecision } from "./pair-decision";
import { buildPairDecision, validatePairDecision } from "./pair-decision";
import type { PairSummary } from "./pair-summary";
import { validatePairSummary } from "./pair-summary";

export const publicationSchemaVersion = "velox.bench-publication/v1" as const;
export const publicationStartMarker = "<!-- BEGIN GENERATED VELOX-WAILS RESULT -->";
export const publicationEndMarker = "<!-- END GENERATED VELOX-WAILS RESULT -->";

export type RunMetadata = {
  schemaVersion: "velox.github-run-metadata/v1";
  repository: "0disoft/velox-bench";
  capturedAtUtc: string;
  run: {
    id: string;
    attempt: number;
    url: string;
    workflowName: string;
    event: string;
    headSha: string;
    status: string;
    conclusion: string;
    createdAtUtc: string;
    startedAtUtc: string;
    completedAtUtc: string;
  };
  jobs: Array<{
    id: string;
    name: string;
    status: string;
    conclusion: string | null;
    startedAtUtc: string | null;
    completedAtUtc: string | null;
  }>;
  artifacts: Array<{
    id: string;
    name: string;
    sizeBytes: number;
    expired: boolean;
  }>;
};

export type PairPublication = {
  schemaVersion: typeof publicationSchemaVersion;
  generatedAtUtc: string;
  scope: "velox-wails";
  suite: "zero-cache";
  source: {
    repository: "0disoft/velox-bench";
    runId: string;
    runAttempt: number;
    runUrl: string;
    benchmarkCommit: string;
    pairSummarySha256: string;
    pairDecisionSha256: string;
    runMetadataSha256: string;
  };
  result: {
    evidenceLevel: "publishable";
    status: "passed";
    fixtureSha256: string;
    expectedPerFramework: number;
    uploadedCacheBytes: 0;
    wailsToVeloxP50Ratio: number;
    rows: Array<{
      framework: "velox" | "wails";
      successful: number;
      failed: number;
      timedOut: number;
      p50Ms: number;
      p95Ms: number;
    }>;
  };
  environment: {
    runner: string;
    runnerImageVersion: string;
    windowsVersion: string;
    architecture: string;
    logicalProcessors: number;
    memoryClassBytes: number;
    hardwareBalanced: true;
  };
  resources: {
    observedJobs: number;
    timedJobs: number;
    successfulJobs: number;
    skippedJobs: number;
    failedJobs: number;
    workflowWallMs: number;
    aggregateJobRuntimeMs: number;
    artifactCount: number;
    artifactBytes: number;
    expiredArtifacts: number;
    uploadedCacheBytes: 0;
  };
};

function isSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function elapsedMs(start: string, finish: string): number {
  const duration = Date.parse(finish) - Date.parse(start);
  if (!Number.isSafeInteger(duration) || duration < 0) throw new Error("run metadata contains an invalid time interval");
  return duration;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function validateRunMetadata(value: unknown): asserts value is RunMetadata {
  if (!value || typeof value !== "object") throw new Error("run metadata must be an object");
  const metadata = value as Partial<RunMetadata>;
  if (metadata.schemaVersion !== "velox.github-run-metadata/v1" || metadata.repository !== "0disoft/velox-bench") {
    throw new Error("unsupported run metadata contract");
  }
  if (!isIsoTimestamp(metadata.capturedAtUtc) || !metadata.run) throw new Error("run metadata capture is invalid");
  if (!/^\d+$/.test(metadata.run.id) || !Number.isSafeInteger(metadata.run.attempt) || metadata.run.attempt < 1) {
    throw new Error("run metadata identity is invalid");
  }
  if (metadata.run.url !== `https://github.com/0disoft/velox-bench/actions/runs/${metadata.run.id}` || !isSha(metadata.run.headSha)) {
    throw new Error("run metadata source is invalid");
  }
  for (const timestamp of [metadata.run.createdAtUtc, metadata.run.startedAtUtc, metadata.run.completedAtUtc]) {
    if (!isIsoTimestamp(timestamp)) throw new Error("run metadata timestamp is invalid");
  }
  elapsedMs(metadata.run.startedAtUtc, metadata.run.completedAtUtc);
  if (metadata.run.status !== "completed" || metadata.run.conclusion !== "success") {
    throw new Error("only a completed successful run can be published");
  }
  if (!Array.isArray(metadata.jobs) || metadata.jobs.length === 0) throw new Error("run metadata jobs are missing");
  for (const job of metadata.jobs) {
    if (!/^\d+$/.test(job.id) || typeof job.name !== "string" || typeof job.status !== "string") {
      throw new Error("run metadata job is invalid");
    }
    if ((job.startedAtUtc === null) !== (job.completedAtUtc === null)) throw new Error("run metadata job interval is incomplete");
    if (job.startedAtUtc !== null && job.completedAtUtc !== null) {
      if (!isIsoTimestamp(job.startedAtUtc) || !isIsoTimestamp(job.completedAtUtc)) throw new Error("run metadata job timestamp is invalid");
      elapsedMs(job.startedAtUtc, job.completedAtUtc);
    }
  }
  if (!Array.isArray(metadata.artifacts) || metadata.artifacts.length === 0) throw new Error("run metadata artifacts are missing");
  for (const artifact of metadata.artifacts) {
    if (!/^\d+$/.test(artifact.id) || typeof artifact.name !== "string" || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0) {
      throw new Error("run metadata artifact is invalid");
    }
  }
}

export function validatePairPublication(value: unknown): asserts value is PairPublication {
  if (!value || typeof value !== "object") throw new Error("publication must be an object");
  const publication = value as Partial<PairPublication>;
  if (publication.schemaVersion !== publicationSchemaVersion || publication.scope !== "velox-wails" || publication.suite !== "zero-cache") {
    throw new Error("unsupported publication contract");
  }
  if (!publication.source || !publication.result || !publication.environment || !publication.resources) {
    throw new Error("publication sections are missing");
  }
  if (publication.result.evidenceLevel !== "publishable" || publication.result.status !== "passed") {
    throw new Error("publication result is not publishable and passed");
  }
  if (publication.resources.failedJobs !== 0 || publication.resources.uploadedCacheBytes !== 0) {
    throw new Error("publication resource gate failed");
  }
}

export function buildPairPublication(
  summaryValue: unknown,
  decisionValue: unknown,
  metadataValue: unknown,
  sourceBytes: { summary: Uint8Array; decision: Uint8Array; metadata: Uint8Array },
  expected: { runId: string; runAttempt: number; benchmarkCommit: string },
): PairPublication {
  validatePairSummary(summaryValue);
  validatePairDecision(decisionValue);
  validateRunMetadata(metadataValue);
  const summary: PairSummary = summaryValue;
  const decision: PairDecision = decisionValue;
  const metadata: RunMetadata = metadataValue;
  const expectedDecision = buildPairDecision(summary);

  if (!summary.publishable || summary.expectedPerFramework !== 10 || summary.environmentCount !== 1 || !summary.hardwareBalanced) {
    throw new Error("pair summary does not satisfy the publication gate");
  }
  if (decision.evidenceLevel !== expectedDecision.evidenceLevel || decision.status !== expectedDecision.status ||
      decision.questionsRequired !== expectedDecision.questionsRequired ||
      decision.metrics.veloxP50Ms !== expectedDecision.metrics.veloxP50Ms ||
      decision.metrics.wailsP50Ms !== expectedDecision.metrics.wailsP50Ms ||
      decision.metrics.wailsToVeloxP50Ratio !== expectedDecision.metrics.wailsToVeloxP50Ratio ||
      Object.entries(expectedDecision.gates).some(([name, value]) => decision.gates[name as keyof PairDecision["gates"]] !== value)) {
    throw new Error("pair decision does not match the pair summary");
  }
  if (decision.evidenceLevel !== "publishable" || decision.status !== "passed" || decision.questionsRequired) {
    throw new Error("pair decision does not satisfy the publication gate");
  }
  if (metadata.run.id !== expected.runId || metadata.run.attempt !== expected.runAttempt || metadata.run.headSha !== expected.benchmarkCommit) {
    throw new Error("publication source does not match the pinned run identity");
  }
  const expectedArtifact = `zero-cache-velox-wails-summary-${expected.runId}-${expected.runAttempt}`;
  if (!metadata.artifacts.some((artifact) => artifact.name === expectedArtifact)) {
    throw new Error("run metadata does not contain the pair summary artifact");
  }
  const rows = summary.rows.map((row) => {
    if (!row.endToEndMs || row.successful !== summary.expectedPerFramework || row.failed !== 0 || row.timedOut !== 0) {
      throw new Error(`pair row ${row.framework} is not publishable`);
    }
    return {
      framework: row.framework,
      successful: row.successful,
      failed: row.failed,
      timedOut: row.timedOut,
      p50Ms: row.endToEndMs.p50,
      p95Ms: row.endToEndMs.p95,
    };
  });
  const environment = summary.environments[0];
  const timedJobs = metadata.jobs.filter((job) => job.startedAtUtc !== null && job.completedAtUtc !== null);
  const failedJobs = metadata.jobs.filter((job) => !["success", "skipped"].includes(job.conclusion ?? "")).length;
  const publication: PairPublication = {
    schemaVersion: publicationSchemaVersion,
    generatedAtUtc: metadata.run.completedAtUtc,
    scope: "velox-wails",
    suite: "zero-cache",
    source: {
      repository: metadata.repository,
      runId: metadata.run.id,
      runAttempt: metadata.run.attempt,
      runUrl: metadata.run.url,
      benchmarkCommit: metadata.run.headSha,
      pairSummarySha256: sha256(sourceBytes.summary),
      pairDecisionSha256: sha256(sourceBytes.decision),
      runMetadataSha256: sha256(sourceBytes.metadata),
    },
    result: {
      evidenceLevel: "publishable",
      status: "passed",
      fixtureSha256: summary.fixtureSha256,
      expectedPerFramework: summary.expectedPerFramework,
      uploadedCacheBytes: summary.uploadedCacheBytes,
      wailsToVeloxP50Ratio: decision.metrics.wailsToVeloxP50Ratio,
      rows,
    },
    environment: {
      runner: environment.runner,
      runnerImageVersion: environment.runnerImageVersion,
      windowsVersion: environment.windowsVersion,
      architecture: environment.architecture,
      logicalProcessors: environment.logicalProcessors,
      memoryClassBytes: environment.memoryClassBytes,
      hardwareBalanced: true,
    },
    resources: {
      observedJobs: metadata.jobs.length,
      timedJobs: timedJobs.length,
      successfulJobs: metadata.jobs.filter((job) => job.conclusion === "success").length,
      skippedJobs: metadata.jobs.filter((job) => job.conclusion === "skipped").length,
      failedJobs,
      workflowWallMs: elapsedMs(metadata.run.startedAtUtc, metadata.run.completedAtUtc),
      aggregateJobRuntimeMs: timedJobs.reduce((total, job) => total + elapsedMs(job.startedAtUtc!, job.completedAtUtc!), 0),
      artifactCount: metadata.artifacts.length,
      artifactBytes: metadata.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0),
      expiredArtifacts: metadata.artifacts.filter((artifact) => artifact.expired).length,
      uploadedCacheBytes: summary.uploadedCacheBytes,
    },
  };
  validatePairPublication(publication);
  return publication;
}

function integer(value: number): string {
  return Math.trunc(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function duration(value: number): string {
  return `${(value / 1000).toFixed(3)} s`;
}

function bytes(value: number): string {
  return `${integer(value)} B`;
}

export function renderPairPublication(publication: PairPublication): string {
  validatePairPublication(publication);
  const rows = publication.result.rows.map((row) =>
    `| ${row.framework === "velox" ? "Velox" : "Wails"} | ${row.successful} | ${integer(row.p50Ms)} ms | ${integer(row.p95Ms)} ms |`,
  );
  return [
    publicationStartMarker,
    "",
    `Source: [GitHub Actions run ${publication.source.runId}](${publication.source.runUrl}) at benchmark revision \`${publication.source.benchmarkCommit}\`.`,
    "This block is generated from the committed publication contract. Do not edit its values by hand.",
    "",
    "| Framework | Successful samples | End-to-end p50 | End-to-end p95 |",
    "| --- | ---: | ---: | ---: |",
    ...rows,
    "",
    `Wails-to-Velox p50 ratio: **${publication.result.wailsToVeloxP50Ratio.toFixed(3)}x**. Uploaded Actions cache: **${bytes(publication.result.uploadedCacheBytes)}**.`,
    "",
    "### CI Resource Observation",
    "",
    "| Observation | Value |",
    "| --- | ---: |",
    `| Workflow wall time | ${duration(publication.resources.workflowWallMs)} |`,
    `| Aggregate observed job runtime | ${duration(publication.resources.aggregateJobRuntimeMs)} |`,
    `| Jobs | ${publication.resources.observedJobs} observed / ${publication.resources.successfulJobs} successful / ${publication.resources.skippedJobs} skipped / ${publication.resources.failedJobs} failed |`,
    `| Artifacts at capture | ${publication.resources.artifactCount} / ${bytes(publication.resources.artifactBytes)} |`,
    `| Expired artifacts at capture | ${publication.resources.expiredArtifacts} |`,
    "",
    "Workflow wall time and aggregate job runtime come from GitHub's wall-clock timestamps. They are observations, not billed Actions minutes. Artifact bytes are the API-reported sizes at capture time.",
    "",
    publicationEndMarker,
  ].join("\n");
}

export function updateReadmePublication(readme: string, rendered: string): string {
  const start = readme.indexOf(publicationStartMarker);
  const end = readme.indexOf(publicationEndMarker);
  if (start < 0 || end < 0 || start >= end) throw new Error("README publication markers are missing or reordered");
  if (readme.indexOf(publicationStartMarker, start + publicationStartMarker.length) >= 0 ||
      readme.indexOf(publicationEndMarker, end + publicationEndMarker.length) >= 0) {
    throw new Error("README publication markers must be unique");
  }
  return `${readme.slice(0, start)}${rendered}${readme.slice(end + publicationEndMarker.length)}`;
}
