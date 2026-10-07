import React from "react";
import type { CustomToolWidgetProps } from "./index";
import type { TurnReviewSnapshot } from "../../../../ai/server/transcript/turnReview";
import "./TurnReviewWidget.css";

export const TurnReviewWidget: React.FC<CustomToolWidgetProps> = ({
  message,
  isExpanded,
  onToggle,
  sessionId,
}) => {
  let review: TurnReviewSnapshot;
  try {
    review = JSON.parse(message.toolCall?.result || "{}");
  } catch {
    return null;
  }
  if (!review.turnId) return null;
  const plan = Array.isArray(review.plan) ? review.plan : [];
  const labels = {
    pending: "Pending",
    inProgress: "In progress",
    completed: "Completed",
  };
  return (
    <section className="turn-review-widget" data-turn-id={review.turnId} data-session-id={sessionId}>
      <button
        type="button"
        className="turn-review-toggle"
        aria-expanded={isExpanded}
        onClick={onToggle}
      >
        Turn review · {plan.filter((p) => p.status === "completed").length}/
        {plan.length} plan steps
      </button>
      {isExpanded && (
        <div className="turn-review-content select-text">
          <p>
            Agent plan and change summary. Test results are reviewed separately.
          </p>
          {review.explanation && <p>{review.explanation}</p>}
          <ol>
            {plan.map((p, index) => (
              <li key={index} data-status={p.status}>
                <span>{labels[p.status]}: </span>
                {p.step}
              </li>
            ))}
          </ol>
          {review.planTruncated && <p>Plan preview shortened.</p>}
          {review.diff !== undefined && (
            <details className="turn-review-diff">
              <summary>Review changes</summary>
              <pre>{review.diff || "No changes in this turn."}</pre>
              {review.diffTruncated && (
                <p>
                  Diff preview shortened; consult the full source transcript.
                </p>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
};
