import React, { useEffect, useRef, useState } from "react";
export interface SteeringTarget {
  supported: boolean;
  target: { turnId: string } | null;
}
export function SteeringControl({
  loading,
  text,
  hasAttachments,
  getTarget,
  send,
  onAccepted,
}: {
  loading: boolean;
  text: string;
  hasAttachments: boolean;
  getTarget(): Promise<SteeringTarget>;
  send(
    turnId: string,
    text: string
  ): Promise<{ success: boolean; error?: string }>;
  onAccepted(text: string): void;
}) {
  const [status, setStatus] = useState<SteeringTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    if (!loading) return;
    const refresh = async () => {
      try {
        const next = await getTarget();
        if (!cancelled) setStatus(next);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loading, getTarget]);
  const submit = async () => {
    if (inFlight.current || !status?.target || !text.trim() || hasAttachments)
      return;
    const turnId = status.target.turnId;
    const submittedText = text;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await send(turnId, submittedText);
      if (!mounted.current) return;
      if (result.success) {
        onAccepted(submittedText);
        setNotice("Guidance accepted for the active turn.");
      } else setNotice(result.error || "Steering failed. Your draft was kept.");
    } catch (error) {
      if (mounted.current)
        setNotice(
          error instanceof Error
            ? error.message
            : "Steering failed. Your draft was kept."
        );
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  if (!loading || !status?.supported)
    return notice ? (
      <div className="steering-control px-3 py-2 text-xs text-nim-muted">
        <p className="steering-notice select-text" role="status">
          {notice}
        </p>
      </div>
    ) : null;
  return (
    <div className="steering-control flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-nim-muted">
      <button
        type="button"
        className="steer-active-turn border border-nim rounded px-2 py-1 hover:bg-nim-hover disabled:opacity-40"
        disabled={busy || !status.target || !text.trim() || hasAttachments}
        onClick={submit}
      >
        Steer active turn
      </button>
      <span>
        {hasAttachments
          ? "Queue attachments; steering sends text only."
          : "Add guidance without interrupting. Enter keeps queueing."}
      </span>
      {notice && (
        <p className="steering-notice select-text" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
