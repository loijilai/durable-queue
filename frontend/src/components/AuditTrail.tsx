import { type JobStatus, type TranscriptionJob } from "../lib/api.ts";

// worker_attempts 只存 {host, at}，沒存結果——結果從「位置 + job 狀態」推斷：
// 非最後一筆 = 被後續認領取代（那台掛了）；最後一筆看 job 現在的狀態。
function attemptState(
  isLast: boolean,
  jobStatus: JobStatus,
): { label: string; cls: string } {
  if (!isLast) return { label: "handed off", cls: "attempt-dead" };
  switch (jobStatus) {
    case "running":
      return { label: "running here", cls: "attempt-active" };
    case "succeeded":
      return { label: "succeeded here", cls: "attempt-done" };
    case "failed":
      return { label: "failed here", cls: "attempt-failed" };
    default:
      return { label: "ended, awaiting re-claim", cls: "attempt-dead" };
  }
}

function AuditTrail({ job }: { job: TranscriptionJob }) {
  const attempts = job.worker_attempts ?? [];
  if (attempts.length === 0) {
    return <p className="audit-empty">No worker has claimed this job yet.</p>;
  }
  return (
    <ol className="audit-trail">
      {attempts.map((a, i) => {
        const { label, cls } = attemptState(i === attempts.length - 1, job.status);
        return (
          <li key={i} className={`audit-row ${cls}`}>
            <span className="audit-dot" />
            <code className="audit-host">{a.host}</code>
            <span className="audit-state">{label}</span>
            <span className="audit-time">
              {new Date(a.at).toLocaleTimeString()}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default AuditTrail;
