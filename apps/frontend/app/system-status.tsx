"use client";

import { useEffect, useState } from "react";

type Readiness = {
  status: "ready" | "not_ready";
  checks: Array<{ name: string; status: "pass" | "fail"; detail?: string }>;
};

export function SystemStatus() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/v1/system/readiness")
      .then(async (response) => {
        const body = (await response.json()) as Readiness;
        if (!response.ok) throw new Error("Backend is unavailable");
        if (!cancelled) setReadiness(body);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const label = readiness ? "Connected" : unavailable ? "Unavailable" : "Checking";

  return (
    <section className="status-panel" aria-labelledby="status-heading">
      <div className="status-heading">
        <div>
          <p className="section-label">System</p>
          <h2 id="status-heading">{readiness ? "Ready for company data" : unavailable ? "Backend unavailable" : "Checking services"}</h2>
        </div>
        <p className={`status-signal ${readiness ? "is-ready" : ""}`} aria-live="polite">
          <span aria-hidden="true" />
          {label}
        </p>
      </div>

      {readiness && (
        <ul className="service-list">
          {readiness.checks.map((check) => (
            <li key={check.name}>
              <span>{check.name}</span>
              <strong>{check.status === "pass" ? "Connected" : "Unavailable"}</strong>
            </li>
          ))}
        </ul>
      )}

      {unavailable && (
        <p className="status-copy">Start the backend service, then refresh this page. The browser connects through the secThing application, not directly to SEC services.</p>
      )}
    </section>
  );
}
