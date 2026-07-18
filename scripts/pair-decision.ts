import { evaluateDecision, type DecisionEvaluation } from "./decision";
import type { PairSummary } from "./pair-summary";

export type PairDecision = DecisionEvaluation & {
  schemaVersion: "actutum.bench-pair-decision/v2";
  suite: "zero-cache";
  scope: "actutum-wails";
};

export function validatePairDecision(value: unknown): asserts value is PairDecision {
  if (!value || typeof value !== "object") throw new Error("pair decision must be an object");
  const decision = value as Partial<PairDecision>;
  if (decision.schemaVersion !== "actutum.bench-pair-decision/v2" || decision.suite !== "zero-cache" || decision.scope !== "actutum-wails") {
    throw new Error("unsupported pair decision contract");
  }
  if (!decision.target || decision.target.metric !== "wails-to-actutum-p50-ratio" || decision.target.minimum !== 3) {
    throw new Error("pair decision target is invalid");
  }
  if (!decision.gates || typeof decision.questionsRequired !== "boolean") throw new Error("pair decision gates are invalid");
}

export function buildPairDecision(summary: PairSummary): PairDecision {
  const decision: PairDecision = {
    schemaVersion: "actutum.bench-pair-decision/v2",
    suite: "zero-cache",
    scope: "actutum-wails",
    ...evaluateDecision(summary),
  };
  validatePairDecision(decision);
  return decision;
}
