import { normalizeProgress, roundedProgressPercent } from "./progress";

export function ReadingProgress({ progress }: { progress: number | null }) {
  const normalized = normalizeProgress(progress);
  const percent = roundedProgressPercent(progress);
  if (normalized === null || percent === null) return null;

  return (
    <div
      className="reading-progress"
      role="progressbar"
      aria-label={`${percent}% read`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <span className="reading-progress-track" aria-hidden="true">
        <span className="reading-progress-fill" style={{ width: `${normalized * 100}%` }} />
      </span>
      <span className="reading-progress-label">{percent}%</span>
    </div>
  );
}
