import type { AIProvider } from "./AIProvider";
export interface SteeringProvider {
  getSteeringTarget(sessionId: string): { turnId: string } | null;
  steerTurn(
    sessionId: string,
    expectedTurnId: string,
    text: string
  ): Promise<{ turnId: string }>;
}
export function isSteeringProvider(
  provider: AIProvider | null
): provider is AIProvider & SteeringProvider {
  const candidate = provider as (AIProvider & Partial<SteeringProvider>) | null;
  return (
    !!candidate?.getAgentCapabilities().steering &&
    typeof candidate.getSteeringTarget === "function" &&
    typeof candidate.steerTurn === "function"
  );
}
export function validateSteeringInput(
  expectedTurnId: string,
  text: string
): void {
  if (
    typeof expectedTurnId !== "string" ||
    !expectedTurnId ||
    expectedTurnId.length > 256
  )
    throw new Error("An expected active turn is required.");
  if (typeof text !== "string" || !text.trim() || text.length > 32768)
    throw new Error(
      "Steering requires nonempty text of at most 32768 characters."
    );
}
