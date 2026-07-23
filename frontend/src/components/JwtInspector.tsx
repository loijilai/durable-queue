import { useEffect, useState } from "react";
import type { JwtPayload } from "../lib/authStorage.ts";

function formatTimestamp(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function formatCountdown(secondsLeft: number) {
  if (secondsLeft <= 0) return "expired";
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  return `${m}m ${s}s`;
}

interface JwtInspectorProps {
  token: string
  payload: JwtPayload
}

function JwtInspector({ token, payload }: JwtInspectorProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = Math.floor(payload.exp - now / 1000);

  return (
    <div className="jwt-inspector">
      <p className="eyebrow">
        <span className="eyebrow-dot" />
        INSPECT MY TOKEN
      </p>
      <p className="jwt-note">
        Decoded client-side from the access token below.
      </p>
      <div className="jwt-raw">{token}</div>
      <dl className="jwt-fields">
        <dt>user_id</dt>
        <dd>{payload.user_id}</dd>
        <dt>iat (issued at)</dt>
        <dd>{formatTimestamp(payload.iat)}</dd>
        <dt>exp (expires at)</dt>
        <dd>{formatTimestamp(payload.exp)}</dd>
        <dt>time left</dt>
        <dd className={secondsLeft <= 0 ? "jwt-expired" : ""}>
          {formatCountdown(secondsLeft)}
        </dd>
      </dl>
    </div>
  );
}

export default JwtInspector;
