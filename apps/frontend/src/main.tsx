import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Readiness = {
  status: "ready" | "not_ready";
  checks: Array<{ name: string; status: "pass" | "fail"; detail?: string }>;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

function App() {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${apiBaseUrl}/ready`)
      .then(async (response) => {
        const body = (await response.json()) as Readiness;
        if (!response.ok) throw new Error(body.status === "not_ready" ? "System checks did not pass." : "Backend is unavailable.");
        if (!cancelled) setReadiness(body);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Backend is unavailable.");
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="shell">
      <header>
        <a className="wordmark" href="/">secThing</a>
        <span className="phase">Foundation</span>
      </header>
      <section className="intro" aria-labelledby="page-title">
        <p className="kicker">SEC research workbench</p>
        <h1 id="page-title">Your evidence bank starts here.</h1>
        <p className="lede">The system foundation is online. Company research, filings, and source-backed answers arrive in the next phases.</p>
      </section>
      <section className="status" aria-labelledby="status-title">
        <div>
          <p className="kicker">System status</p>
          <h2 id="status-title">{readiness ? "Ready for company data" : error ? "Waiting for backend" : "Checking services"}</h2>
        </div>
        <div className={`indicator ${readiness ? "pass" : "pending"}`} aria-live="polite">
          <span aria-hidden="true" />
          {readiness ? "Ready" : error ? "Unavailable" : "Checking"}
        </div>
        {readiness && <ul>{readiness.checks.map((check) => <li key={check.name}><span>{check.name}</span><strong>{check.status === "pass" ? "Connected" : "Unavailable"}</strong></li>)}</ul>}
        {error && <p className="error">{error} Confirm that the backend is running and reachable at <code>{apiBaseUrl}</code>.</p>}
      </section>
      <footer>Local-first SEC filing research. Not investment advice.</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);

