"use client";

import { useEffect, useState } from "react";

type Readiness = {
  status: "ready" | "not_ready";
  checks: Array<{ name: string; status: "pass" | "fail"; detail?: string }>;
};

type AiStatus = {
  mode: "disabled" | "local" | "external";
  status: "disabled" | "unavailable" | "available";
  detail?: string;
  models: Array<{ name: string }>;
  chat: { configuredModel?: string; available: boolean };
  embeddings: { configuredModel?: string; available: boolean };
};

export function SystemStatus() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
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

    void fetch("/api/v1/system/ai/status")
      .then(async (response) => {
        if (!response.ok) throw new Error("AI status is unavailable");
        const body = (await response.json()) as AiStatus;
        if (!cancelled) setAiStatus(body);
      })
      .catch(() => undefined);

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
          {aiStatus && (
            <li>
              <span>Local AI</span>
              <strong className={aiStatus.status === "available" ? "" : "is-muted"}>
                {aiStatus.status === "disabled"
                  ? "Disabled"
                  : aiStatus.status === "unavailable"
                    ? "Unavailable"
                    : aiStatus.chat.available
                      ? `Ready · ${aiStatus.chat.configuredModel}`
                      : "Runtime ready · model needed"}
              </strong>
            </li>
          )}
        </ul>
      )}

      {unavailable && (
        <p className="status-copy">Start the backend service, then refresh this page. The browser connects through the secThing application, not directly to SEC services.</p>
      )}
    </section>
  );
}
