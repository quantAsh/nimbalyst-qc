// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  assertSteeringWorkspace,
  createSteeringControl,
} from "../steeringControl";
const harness = () => {
  const provider = {
    getAgentCapabilities: () => ({ steering: true }),
    getSteeringTarget: vi.fn(() => ({ turnId: "turn-1" })),
    steerTurn: vi.fn(async (_id, turnId) => ({ turnId })),
  };
  const getProvider = vi.fn(() => provider as never);
  const control = createSteeringControl({
    getSession: async () => ({
      provider: "openai-codex",
      workspacePath: "/owner",
      worktreePath: "/worktree",
    }),
    getProvider,
  });
  return { provider, getProvider, control };
};
describe("workspace-scoped steering", () => {
  it("rejects foreign windows and sessions before resolving a provider", async () => {
    const { control, getProvider } = harness();
    expect(() => assertSteeringWorkspace("/other", "/owner")).toThrow(
      /calling window/
    );
    expect(() => assertSteeringWorkspace(undefined, "/owner")).toThrow(
      /calling window/
    );
    await expect(
      control.send("s", "/other", "turn-1", "Guidance")
    ).rejects.toThrow(/workspace/);
    expect(getProvider).not.toHaveBeenCalled();
    await expect(control.target("s", "/worktree")).resolves.toMatchObject({
      supported: true,
    });
  });
  it("passes the exact turn through and preserves server rejection without queueing", async () => {
    const { control, provider } = harness();
    await expect(
      control.send("s", "/owner", "turn-1", "Guidance")
    ).resolves.toEqual({ turnId: "turn-1" });
    expect(provider.steerTurn).toHaveBeenCalledWith("s", "turn-1", "Guidance");
    provider.steerTurn.mockRejectedValueOnce(new Error("Turn ended"));
    await expect(
      control.send("s", "/owner", "turn-1", "Late guidance")
    ).rejects.toThrow("Turn ended");
    await expect(
      control.send("s", "/owner", "turn-1", " ".repeat(3))
    ).rejects.toThrow(/nonempty/);
    expect(provider.steerTurn).toHaveBeenCalledTimes(2);
  });
  it("fails closed for unsupported providers even when they expose similar methods", async () => {
    const { control, provider } = harness();
    provider.getAgentCapabilities = () => ({ steering: false });
    await expect(control.target("s", "/owner")).resolves.toEqual({
      supported: false,
      target: null,
    });
    await expect(
      control.send("s", "/owner", "turn-1", "Guidance")
    ).rejects.toThrow(/Queue/);
    expect(provider.steerTurn).not.toHaveBeenCalled();
  });
});
