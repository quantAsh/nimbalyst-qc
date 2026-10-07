export interface TurnPlanStep {
  step: string;
  status: "pending" | "inProgress" | "completed";
}
export interface TurnReviewPatch {
  threadId: string;
  turnId: string;
  revision: number;
  plan?: TurnPlanStep[];
  explanation?: string;
  diff?: string;
  planTruncated?: boolean;
  diffTruncated?: boolean;
}
export interface TurnReviewSnapshot extends TurnReviewPatch {
  planRevision?: number;
  diffRevision?: number;
}
export function parseTurnReview(
  method: string,
  params: Record<string, unknown>,
  revision: number
): TurnReviewPatch | null {
  const { threadId, turnId } = params;
  if (
    typeof threadId !== "string" ||
    !threadId ||
    threadId.length > 256 ||
    typeof turnId !== "string" ||
    !turnId ||
    turnId.length > 256 ||
    !Number.isSafeInteger(revision)
  )
    return null;
  const common = { threadId, turnId, revision };
  if (method === "turn/plan/updated") {
    if (
      !Array.isArray(params.plan) ||
      params.plan.some(
        (p) =>
          !p ||
          typeof p.step !== "string" ||
          !["pending", "inProgress", "completed"].includes(p.status)
      )
    )
      return null;
    return {
      ...common,
      plan: params.plan
        .slice(0, 100)
        .map((p) => ({ step: p.step.slice(0, 2000), status: p.status })),
      explanation:
        typeof params.explanation === "string"
          ? params.explanation.slice(0, 4000)
          : "",
      planTruncated:
        params.plan.length > 100 ||
        params.plan.some((p) => p.step.length > 2000),
    };
  }
  if (method === "turn/diff/updated" && typeof params.diff === "string")
    return {
      ...common,
      diff: params.diff.slice(0, 131072),
      diffTruncated: params.diff.length > 131072,
    };
  return null;
}
