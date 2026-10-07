import { describe, it, expect } from "vitest";
import { rawMessagesToCanonicalEvents } from "../projectRawMessages";
import type { RawMessage } from "../TranscriptTransformer";
const raw = (
  id: number,
  method: string,
  params: Record<string, unknown>,
  sessionId = "session-a"
): RawMessage => ({
  id,
  sessionId,
  source: "openai-codex",
  direction: "output",
  createdAt: new Date(id * 1000),
  content: JSON.stringify({ method, params }),
  metadata: { transport: "app-server" },
});
const plan = (id: number, status = "pending", turnId = "turn-a") =>
  raw(id, "turn/plan/updated", {
    threadId: "thread-a",
    turnId,
    plan: [{ step: "Verify workspace isolation", status }],
  });
const diff = (id: number, text = "diff --git a/a.ts b/a.ts") =>
  raw(id, "turn/diff/updated", {
    threadId: "thread-a",
    turnId: "turn-a",
    diff: text,
  });
const review = (event: any) => JSON.parse(event.payload.result);
describe("replayable turn review", () => {
  it("combines updates into one card per turn and preserves independent plan/diff revisions", async () => {
    const events = await rawMessagesToCanonicalEvents(
      [
        plan(1),
        diff(3),
        plan(4, "completed"),
        plan(2),
        diff(2, "stale"),
        plan(5, "pending", "turn-b"),
      ],
      "openai-codex"
    );
    expect(events).toHaveLength(2);
    expect(review(events[0])).toMatchObject({
      plan: [{ status: "completed" }],
      diff: "diff --git a/a.ts b/a.ts",
      planRevision: 4,
      diffRevision: 3,
    });
    expect(review(events[1]).turnId).toBe("turn-b");
  });
  it("rejects malformed inputs and scopes the resulting review to its session", async () => {
    const events = await rawMessagesToCanonicalEvents(
      [
        plan(1),
        raw(2, "turn/plan/updated", {
          threadId: "thread-a",
          turnId: "turn-a",
          plan: [{ step: "invalid", status: "invented" }],
        }),
      ],
      "openai-codex"
    );
    expect(events).toHaveLength(1);
    expect(events[0].sessionId).toBe("session-a");
    expect(review(events[0]).plan[0].status).toBe("pending");
    const other = await rawMessagesToCanonicalEvents(
      [{ ...plan(1), sessionId: "session-b" }],
      "openai-codex"
    );
    expect(other[0].sessionId).toBe("session-b");
  });
  it("caps display data and makes truncation explicit without altering raw history", async () => {
    const message = diff(1, "x".repeat(140000));
    const original = message.content;
    const events = await rawMessagesToCanonicalEvents(
      [message],
      "openai-codex"
    );
    expect(review(events[0]).diff).toHaveLength(131072);
    expect(review(events[0]).diffTruncated).toBe(true);
    expect(message.content).toBe(original);
  });
});
