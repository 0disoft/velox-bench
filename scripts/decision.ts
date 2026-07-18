import type { Framework } from "./contracts";
import type { BenchmarkSummary } from "./summary";

export type BenchmarkDecision = {
  schemaVersion: "actutum.bench-decision/v2";
  suite: "zero-cache";
  evidenceLevel: "diagnostic" | "publishable";
  status: "promising" | "below-target" | "passed" | "failed" | "insufficient-evidence";
  target: { metric: "wails-to-actutum-p50-ratio"; minimum: 3 };
  metrics: { actutumP50Ms: number | null; wailsP50Ms: number | null; wailsToActutumP50Ratio: number | null };
  gates: {
    completeSuccessfulSamples: boolean;
    singleEnvironment: boolean;
    hardwareBalanced: boolean;
    zeroCacheUpload: boolean;
    minimumSpeedup: boolean | null;
  };
  questionsRequired: boolean;
};

export function validateDecision(value: unknown): asserts value is BenchmarkDecision {
  if (!value || typeof value !== "object") throw new Error("decision must be an object");
  const decision = value as Partial<BenchmarkDecision>;
  if (decision.schemaVersion !== "actutum.bench-decision/v2" || decision.suite !== "zero-cache") throw new Error("unsupported decision contract");
  if (!decision.target || decision.target.metric !== "wails-to-actutum-p50-ratio" || decision.target.minimum !== 3) throw new Error("decision target is invalid");
  if (!decision.gates || typeof decision.questionsRequired !== "boolean") throw new Error("decision gates are invalid");
}

export type DecisionInput = Pick<BenchmarkSummary, "expectedPerFramework" | "uploadedCacheBytes" | "environmentCount" | "hardwareBalanced" | "publishable" | "rows">;
export type DecisionEvaluation = Omit<BenchmarkDecision, "schemaVersion" | "suite">;

function row(summary: DecisionInput, framework: Framework) {
  const value = summary.rows.find((candidate) => candidate.framework === framework);
  if (!value) throw new Error(`summary is missing ${framework}`);
  return value;
}

export function evaluateDecision(summary: DecisionInput): DecisionEvaluation {
  const actutum = row(summary, "actutum");
  const wails = row(summary, "wails");
  const completeSuccessfulSamples = summary.rows.every((candidate) =>
    candidate.observed === summary.expectedPerFramework &&
    candidate.successful === summary.expectedPerFramework &&
    candidate.failed === 0 &&
    candidate.timedOut === 0 &&
    candidate.missing === 0,
  );
  const singleEnvironment = summary.environmentCount === 1;
  const hardwareBalanced = summary.hardwareBalanced;
  const zeroCacheUpload = summary.uploadedCacheBytes === 0;
  const actutumP50Ms = actutum.endToEndMs?.p50 ?? null;
  const wailsP50Ms = wails.endToEndMs?.p50 ?? null;
  const ratio = actutumP50Ms !== null && actutumP50Ms > 0 && wailsP50Ms !== null
    ? Number((wailsP50Ms / actutumP50Ms).toFixed(3))
    : null;
  const comparable = completeSuccessfulSamples && singleEnvironment && hardwareBalanced && zeroCacheUpload && ratio !== null;
  const minimumSpeedup = comparable ? ratio >= 3 : null;
  const evidenceLevel = summary.expectedPerFramework === 10 && summary.publishable ? "publishable" : "diagnostic";
  let status: BenchmarkDecision["status"] = "insufficient-evidence";
  if (comparable && evidenceLevel === "publishable") status = minimumSpeedup ? "passed" : "failed";
  else if (comparable) status = minimumSpeedup ? "promising" : "below-target";
  return {
    evidenceLevel,
    status,
    target: { metric: "wails-to-actutum-p50-ratio", minimum: 3 },
    metrics: { actutumP50Ms, wailsP50Ms, wailsToActutumP50Ratio: ratio },
    gates: { completeSuccessfulSamples, singleEnvironment, hardwareBalanced, zeroCacheUpload, minimumSpeedup },
    questionsRequired: status === "below-target" || status === "failed",
  };
}

export function buildDecision(summary: BenchmarkSummary): BenchmarkDecision {
  const decision: BenchmarkDecision = {
    schemaVersion: "actutum.bench-decision/v2",
    suite: "zero-cache",
    ...evaluateDecision(summary),
  };
  validateDecision(decision);
  return decision;
}
