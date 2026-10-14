"use client";

import { useEffect, useRef, useState } from "react";
import { dateLabel, post, request } from "./types";

type Identity = {
  id: string;
  cik: string;
  name: string;
  ticker: string;
  exchange?: string;
  existed: boolean;
  earliest_requested_filing_date?: string;
};
type Props = {
  onClose: () => void;
  onOpen: (id: string) => void;
  onQueued: () => void;
};

export function AddCompany({ onClose, onOpen, onQueued }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [step, setStep] = useState(0);
  const [ticker, setTicker] = useState("");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [lookback, setLookback] = useState("3");
  const [customDate, setCustomDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - (Number(lookback) || 3));
  const from =
    lookback === "all"
      ? "1900-01-01"
      : lookback === "custom"
        ? customDate
        : date.toISOString().slice(0, 10);

  useEffect(() => {
    returnFocus.current ??= document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current?.querySelector("input")?.focus();
    return () => {
      controller.current?.abort();
      requestAnimationFrame(() => {
        if (!dialog.current?.open) returnFocus.current?.focus();
      });
    };
  }, []);

  async function resolve() {
    setBusy(true);
    setError("");
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await request<{ company?: Identity; jobId?: string }>(
        "/api/v1/companies/resolve",
        { ...post({ ticker }), signal: abort.signal },
      );
      let company = result.company;
      if (!company && result.jobId) {
        for (let count = 0; count < 120 && !abort.signal.aborted; count++) {
          await new Promise((done) => setTimeout(done, 1000));
          if (abort.signal.aborted) return;
          const status = await request<{
            job: {
              status: string;
              progress: { company?: Identity };
              last_error?: string;
            };
          }>(`/api/v1/jobs/${result.jobId}`, { signal: abort.signal });
          if (status.job.progress.company) {
            company = status.job.progress.company;
            break;
          }
          if (["partial", "failed"].includes(status.job.status))
            throw new Error(
              status.job.last_error ??
                "Company lookup failed. Check the ticker and retry.",
            );
        }
      }
      if (!company)
        throw new Error("Lookup is taking longer than expected. Please retry.");
      if (!abort.signal.aborted) {
        setIdentity(company);
        setStep(1);
      }
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      const result = await request<{ companyId?: string }>(
        "/api/v1/companies",
        post({
          ticker: identity!.ticker,
          confirmedCik: Number(identity!.cik),
          startDate: from,
          lookback,
          refresh,
        }),
      );
      onQueued();
      if (result.companyId) onOpen(String(result.companyId));
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="intake-dialog"
      aria-labelledby="intake-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <span>Add to your library</span>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close add company"
        >
          ×
        </button>
      </header>
      <ol className="steps">
        {["Find company", "Choose coverage", "Start research"].map(
          (label, i) => (
            <li key={label} aria-current={step === i ? "step" : undefined}>
              <span>{i + 1}</span>
              {label}
            </li>
          ),
        )}
      </ol>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step === 0) void resolve();
          else if (step === 1) setStep(2);
          else void start();
        }}
      >
        <h2 id="intake-title">
          {
            [
              "Which company are you researching?",
              "How far back should we look?",
              "Ready to build your evidence library?",
            ][step]
          }
        </h2>
        {step === 0 ? (
          <>
            <p>Find a public company using its SEC ticker.</p>
            <label>
              Ticker
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder="e.g. LINC"
                maxLength={16}
                required
                disabled={busy}
              />
            </label>
          </>
        ) : (
          <>
            <div className="identity">
              <span className="ticker-tag">{identity?.ticker}</span>
              <div>
                <strong>{identity?.name}</strong>
                <small>
                  CIK {String(identity?.cik).padStart(10, "0")}
                  {identity?.exchange ? ` · ${identity.exchange}` : ""}
                </small>
              </div>
            </div>
            {step === 1 ? (
              <>
                {identity?.existed && (
                  <div className="existing-note">
                    This company is already in your library.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        onOpen(String(identity.id));
                        onClose();
                      }}
                    >
                      Open record
                    </button>
                  </div>
                )}
                <fieldset className="lookback-options">
                  <legend>Research window</legend>
                  {["3", "5", "10", "20", "50", "all", "custom"].map(
                    (value) => (
                      <label
                        key={value}
                        className={lookback === value ? "selected" : ""}
                      >
                        <input
                          type="radio"
                          name="lookback"
                          value={value}
                          checked={lookback === value}
                          onChange={() => setLookback(value)}
                        />
                        {value === "all"
                          ? "All available"
                          : value === "custom"
                            ? "Custom"
                            : `${value} years`}
                      </label>
                    ),
                  )}
                </fieldset>
                {lookback === "custom" && (
                  <label>
                    Coverage starts
                    <input
                      type="date"
                      required
                      max={today}
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                    />
                  </label>
                )}
                <p className="hint">
                  Older windows take longer and may contain filings with limited
                  text extraction.
                </p>
                {identity?.existed && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={refresh}
                      onChange={(e) => setRefresh(e.target.checked)}
                    />
                    Discover new filings as well as expanding history
                  </label>
                )}
              </>
            ) : (
              <>
                <dl className="confirmation">
                  <div>
                    <dt>Coverage</dt>
                    <dd>
                      {lookback === "all"
                        ? "All available SEC history"
                        : `${dateLabel(from)} to today`}
                    </dd>
                  </div>
                  <div>
                    <dt>Sources</dt>
                    <dd>10-K, 10-Q and 8-K primary filings</dd>
                  </div>
                  <div>
                    <dt>Processing</dt>
                    <dd>Preserve sources, extract text and index evidence</dd>
                  </div>
                </dl>
                <p>
                  You can start reading as filings become available. Processing
                  continues when this window closes.
                </p>
              </>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {step > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          ) : (
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            className="primary-button"
            type="submit"
            disabled={busy || (step === 0 && !ticker.trim())}
          >
            {busy
              ? step === 0
                ? "Resolving company…"
                : "Starting…"
              : ["Find company", "Review coverage", "Start research"][step]}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
