"use client";

import { useEffect, useRef, useState } from "react";

type Readiness = {
  status: "ready" | "not_ready";
  checks: Array<{ name: string; status: "pass" | "fail"; detail?: string }>;
};

type AiStatus = {
  mode: "disabled" | "local" | "external";
  status: "disabled" | "unavailable" | "available";
  chat: { configuredModel?: string; available: boolean };
  embeddings: { configuredModel?: string; available: boolean };
};

export function SystemStatus() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/v1/system/readiness")
      .then(async (response) => {
        const body = (await response.json()) as Readiness;
        if (!response.ok) throw new Error("Backend is unavailable");
        if (!cancelled) { setReadiness(body); setUnavailable(false); }
      })
      .catch(() => !cancelled && setUnavailable(true));
    void fetch("/api/v1/system/ai/status")
      .then(async (response) => {
        if (!response.ok) throw new Error("AI status is unavailable");
        const body = (await response.json()) as AiStatus;
        if (!cancelled) setAiStatus(body);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  const state = unavailable
    ? { label: "Service unavailable", tone: "danger" }
    : !readiness
      ? { label: "Checking services", tone: "pending" }
      : readiness.status === "ready"
        ? { label: "Services ready", tone: "ready" }
        : { label: "Service needs attention", tone: "warning" };

  return (
    <>
      <button ref={trigger} className="system-status-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className={`status-dot ${state.tone}`} aria-hidden="true" />
        {state.label}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="status-dialog"
          aria-labelledby="system-status-title"
          onCancel={(event) => { event.preventDefault(); setOpen(false); }}
          onClose={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }}
        >
          <header className="dialog-heading">
            <div><p>System status</p><h2 id="system-status-title">{state.label}</h2></div>
            <button className="icon-button" aria-label="Close system status" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="status-dialog-body">
            {unavailable ? (
              <p className="status-guidance">Start the backend service, then reload this page. secThing never asks the browser to contact SEC services directly.</p>
            ) : !readiness ? (
              <p className="status-guidance">Checking the services needed to preserve and search filings.</p>
            ) : (
              <ul className="status-list">
                {readiness.checks.map((check) => (
                  <li key={check.name}>
                    <span>{check.name}</span>
                    <strong className={check.status === "pass" ? "ready" : "danger"}>{check.status === "pass" ? "Connected" : "Unavailable"}</strong>
                  </li>
                ))}
                <li>
                  <span>Meaning search</span>
                  <strong className={aiStatus?.embeddings.available ? "ready" : "muted"}>
                    {aiStatus?.embeddings.available
                      ? `Ready${aiStatus.embeddings.configuredModel ? ` — ${aiStatus.embeddings.configuredModel}` : ""}`
                      : aiStatus?.status === "unavailable" ? "Runtime unavailable" : "Not configured"}
                  </strong>
                </li>
              </ul>
            )}
            <p className="status-footnote">Exact-word search remains available without a configured AI model.</p>
          </div>
        </dialog>
      )}
    </>
  );
}
