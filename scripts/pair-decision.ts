import { evaluateDecision, type DecisionEvaluation } from "./decision";
import type { PairSummary } from "./pair-summary";

export type PairDecision = DecisionEvaluation & {
  schemaVersion: "velox.bench-pair-decision/v1";
  suite: "zero-cache";
  scope: "velox-wails";
};

export function validatePairDecision(value: unknown): asserts value is PairDecision {
  if (!value || typeof value !== "object") throw new Error("pair decision must be an object");
  const decision = value as Partial<PairDecision>;
  if (decision.schemaVersion !== "velox.bench-pair-decision/v1" || decision.suite !== "zero-cache" || decision.scope !== "velox-wails") {
    throw new Error("unsupported pair decision contract");
  }
  if (!decision.target || decision.target.metric !== "wails-to-velox-p50-ratio" || decision.target.minimum !== 3) {
    throw new Error("pair decision target is invalid");
  }
  if (!decision.gates || typeof decision.questionsRequired !== "boolean") throw new Error("pair decision gates are invalid");
}

export function buildPairDecision(summary: PairSummary): PairDecision {
  const decision: PairDecision = {
    schemaVersion: "velox.bench-pair-decision/v1",
    suite: "zero-cache",
    scope: "velox-wails",
    ...evaluateDecision(summary),
  };
  validatePairDecision(decision);
  return decision;
}
