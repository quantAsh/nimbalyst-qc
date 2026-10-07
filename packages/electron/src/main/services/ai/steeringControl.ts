import {
  isSteeringProvider,
  validateSteeringInput,
} from "@nimbalyst/runtime/ai/server/steering";
import type { AIProvider } from "@nimbalyst/runtime/ai/server/AIProvider";
interface SessionScope {
  provider: string;
  workspacePath?: string;
  worktreePath?: string | null;
}
export function createSteeringControl(deps: {
  getSession(id: string): Promise<SessionScope | null>;
  getProvider(type: string, id: string): AIProvider | null;
}) {
  const resolve = async (sessionId: string, workspacePath: string) => {
    if (
      typeof sessionId !== "string" ||
      !sessionId ||
      typeof workspacePath !== "string" ||
      !workspacePath
    )
      throw new Error("Steering requires sessionId and workspacePath.");
    const session = await deps.getSession(sessionId);
    if (
      !session ||
      (session.workspacePath !== workspacePath &&
        session.worktreePath !== workspacePath)
    )
      throw new Error("The session does not belong to this workspace.");
    const provider = deps.getProvider(session.provider, sessionId);
    return isSteeringProvider(provider) ? provider : null;
  };
  return {
    async target(sessionId: string, workspacePath: string) {
      const provider = await resolve(sessionId, workspacePath);
      return {
        supported: !!provider,
        target: provider?.getSteeringTarget(sessionId) ?? null,
      };
    },
    async send(
      sessionId: string,
      workspacePath: string,
      expectedTurnId: string,
      text: string
    ) {
      validateSteeringInput(expectedTurnId, text);
      const provider = await resolve(sessionId, workspacePath);
      if (!provider)
        throw new Error(
          "This provider does not support steering. Queue your message instead."
        );
      return provider.steerTurn(sessionId, expectedTurnId, text);
    },
  };
}

export function assertSteeringWorkspace(
  senderWorkspace: string | null | undefined,
  workspacePath: string
): void {
  if (!workspacePath || senderWorkspace !== workspacePath)
    throw new Error("Steering workspace does not match the calling window.");
}
