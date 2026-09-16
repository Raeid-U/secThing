"use client";

import { FormEvent, useEffect, useState } from "react";

type Company = { id: number; cik: number; legal_name: string; tickers: string[]; ingestion_status: string | null; earliest_requested_filing_date: string | null };
type Filing = { id: number; accession_number: string; form_type: string; filing_date: string; report_date: string | null; is_supported: boolean; filing_status: string };
type Address = { street1?: string; street2?: string; city?: string; stateOrCountryDescription?: string; stateOrCountry?: string; zipCode?: string };
type CompanyDetail = { company: { id: number; cik: number; legal_name: string; exchange: string | null; sic: string | null; sic_description: string | null; entity_type: string | null; fiscal_year_end: string | null; state_of_incorporation_description: string | null; state_of_incorporation: string | null; business_address: Address | null; earliest_requested_filing_date: string | null }; filings: Filing[] };
type Job = { job: { id: number; company_id: number | null; status: string; progress: { filings?: { discovered: number; total: number }; identity?: string; metadata?: string }; last_error: string | null } };

function defaultStartDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 3);
  return date.toISOString().slice(0, 10);
}

function formatAddress(address: Address | null): string | null {
  if (!address) return null;
  return [address.street1, address.street2, address.city, address.stateOrCountryDescription ?? address.stateOrCountry, address.zipCode].filter(Boolean).join(", ");
}

export function CompanyWorkbench() {
  const [ticker, setTicker] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selected, setSelected] = useState<CompanyDetail | null>(null);
  const [notice, setNotice] = useState("Enter a ticker to create a local research record.");
  const [busy, setBusy] = useState(false);

  const loadCompanies = async () => {
    const response = await fetch("/api/v1/companies");
    if (!response.ok) throw new Error("Company library is unavailable.");
    setCompanies((await response.json()) as Company[]);
  };

  useEffect(() => { void loadCompanies().catch(() => undefined); }, []);

  const openCompany = async (id: number) => {
    const response = await fetch(`/api/v1/companies/${id}`);
    if (!response.ok) return;
    setSelected((await response.json()) as CompanyDetail);
  };

  const pollJob = async (jobId: number) => {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const response = await fetch(`/api/v1/jobs/${jobId}`);
      if (!response.ok) continue;
      const result = (await response.json()) as Job;
      const filings = result.job.progress.filings;
      setNotice(`Processing: identity ${result.job.progress.identity ?? "queued"}; metadata ${result.job.progress.metadata ?? "queued"}; filings ${filings?.total ?? 0} stored.`);
      if (result.job.status === "complete" && result.job.company_id) {
        await loadCompanies();
        await openCompany(result.job.company_id);
        setNotice(`Metadata complete. ${filings?.total ?? 0} filings are stored locally; source acquisition and parsing have not started.`);
        return;
      }
      if (result.job.status === "partial") {
        setNotice(result.job.last_error ?? "Processing paused with a retryable error.");
        return;
      }
    }
    setNotice("Processing continues in the background. Refresh this page to check progress.");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/v1/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker, startDate }),
      });
      const result = (await response.json()) as { outcome?: string; companyId?: number; jobId?: number; message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Company intake failed.");
      setNotice(result.message ?? "Company intake queued.");
      if (result.outcome === "existing" && result.companyId) {
        await loadCompanies();
        await openCompany(result.companyId);
      } else if (result.jobId) {
        void pollJob(result.jobId);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Company intake failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workbench" aria-labelledby="company-heading">
      <div className="workbench-head">
        <div>
          <p className="section-label">Company library</p>
          <h2 id="company-heading">Build the filing record.</h2>
        </div>
        <p className="range-note">Three-year default · filing date through today</p>
      </div>
      <form className="company-form" onSubmit={submit}>
        <label>
          <span>Ticker</span>
          <input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} placeholder="LINC" autoComplete="off" required />
        </label>
        <label>
          <span>Start date</span>
          <input type="date" value={startDate} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setStartDate(event.target.value)} required />
        </label>
        <button type="submit" disabled={busy}>{busy ? "Queueing…" : "Add company"}</button>
      </form>
      <p className="intake-note" aria-live="polite">{notice}</p>

      <div className="library-grid">
        <div className="company-list" aria-label="Stored companies">
          {companies.length === 0 ? <p className="empty-state">No companies are stored yet.</p> : companies.map((company) => (
            <button className="company-row" key={company.id} type="button" onClick={() => void openCompany(company.id)}>
              <span>{company.tickers.join(", ")}</span>
              <strong>{company.legal_name}</strong>
              <small>CIK {String(company.cik).padStart(10, "0")} · {company.ingestion_status ?? "stored"}</small>
            </button>
          ))}
        </div>
        <div className="filing-panel" aria-live="polite">
          {!selected ? <p className="empty-state">Select a company to inspect its local filing index.</p> : <>
            <p className="section-label">{selected.company.legal_name}</p>
            <h3>Filing index</h3>
            <p className="filing-context">CIK {String(selected.company.cik).padStart(10, "0")} · coverage from {selected.company.earliest_requested_filing_date ?? "—"}</p>
            <dl className="company-profile">
              <div><dt>SEC industry</dt><dd>{selected.company.sic_description ?? selected.company.sic ?? "Not reported"}</dd></div>
              <div><dt>Entity</dt><dd>{selected.company.entity_type ?? "Not reported"}</dd></div>
              <div><dt>Incorporated in</dt><dd>{selected.company.state_of_incorporation_description ?? selected.company.state_of_incorporation ?? "Not reported"}</dd></div>
              <div><dt>Business address</dt><dd>{formatAddress(selected.company.business_address) ?? "Not reported"}</dd></div>
            </dl>
            <ol className="filing-list">
              {selected.filings.map((filing) => <li key={filing.id}><span>{filing.form_type}</span><time>{filing.filing_date}</time><small>{filing.is_supported ? "MVP form" : "Metadata only"}</small></li>)}
            </ol>
          </>}
        </div>
      </div>
    </section>
  );
}
