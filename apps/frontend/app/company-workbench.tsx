"use client";

import { useEffect, useRef, useState } from "react";
import { AddCompany } from "./research/add-company";
import { DocumentReader } from "./research/document-reader";
import { useWorkspace } from "./research/use-workspace";
import {
  dateLabel,
  emptyLocation,
  filingState,
  post,
  request,
  type Filing,
  type Hit,
} from "./research/types";

function Snippet({ text }: { text: string }) {
  // Treat provider/database snippets as text; only our explicit mark delimiters are rendered.
  return (
    <>
      {text
        .split(/(<mark>|<\/mark>)/g)
        .map((part, index, parts) =>
          part === "<mark>" || part === "</mark>" ? null : parts[index - 1] ===
            "<mark>" ? (
            <mark key={index}>{part}</mark>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
    </>
  );
}

export function CompanyWorkbench() {
  const workspace = useWorkspace();
  const {
    location,
    navigate,
    companies,
    detail,
    reader,
    hits,
    error,
    setError,
    readerError,
    searching,
    searchNote,
    setSearchNote,
    refresh,
    rerunSearch,
  } = workspace;
  const [intake, setIntake] = useState(false);
  const [library, setLibrary] = useState(true);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [indexing, setIndexing] = useState(false);
  const resultsPane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      window.innerWidth < 900 ||
      new URLSearchParams(window.location.search).has("filing")
    )
      setLibrary(false);
  }, []);
  useEffect(() => setQuery(location.q), [location.q]);
  const selectedFiling = detail?.filings.find(
    (filing) => String(filing.id) === location.filing,
  );
  const selectedHit = hits.find(
    (hit) =>
      String(hit.filing_id) === location.filing &&
      String(hit.start_offset) === location.start,
  );
  const filtered =
    detail?.filings.filter(
      (filing) =>
        (!location.formType || filing.form_type === location.formType) &&
        (!location.filedAfter ||
          dateLabel(filing.filing_date) >= location.filedAfter) &&
        (!location.filedBefore ||
          dateLabel(filing.filing_date) <= location.filedBefore) &&
        (!stateFilter || filingState(filing).tone === stateFilter),
    ) ?? [];
  const visibleCompanies = companies.filter((company) =>
    `${company.legal_name} ${company.tickers.join(" ")}`
      .toLowerCase()
      .includes(libraryQuery.toLowerCase()),
  );
  const groups = [...new Set(hits.map((hit) => String(hit.filing_id)))].map(
    (id) => hits.filter((hit) => String(hit.filing_id) === id),
  );
  const processing =
    detail?.jobs.filter((job) => ["pending", "running"].includes(job.status))
      .length ?? 0;

  function openCompany(id: string) {
    navigate({ ...emptyLocation, company: id });
    setNotice("");
    setStateFilter("");
    if (window.innerWidth < 900) setLibrary(false);
  }
  function openFiling(filing: Filing) {
    navigate({
      filing: String(filing.id),
      document: "",
      hash: "",
      start: "",
      end: "",
    });
    setLibrary(false);
  }
  function openHit(hit: Hit) {
    navigate({
      filing: String(hit.filing_id),
      document: String(hit.document_id),
      hash: hit.text_hash,
      start: String(hit.start_offset),
      end: String(hit.end_offset),
    });
    setLibrary(false);
  }
  function nextHit(direction: number) {
    const index = hits.findIndex((hit) => hit === selectedHit);
    if (hits.length)
      openHit(
        hits[(Math.max(0, index) + direction + hits.length) % hits.length],
      );
  }
  async function queue(filing: Filing) {
    setNotice("");
    const action =
      filing.source_status !== "downloaded"
        ? "source/acquire"
        : filing.parse_status !== "parsed"
          ? "parse"
          : "chunk";
    try {
      await request(`/api/v1/filings/${filing.id}/${action}`, post());
      setNotice("Evidence processing queued. You can continue researching.");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reindex() {
    setIndexing(true);
    try {
      const result = await request<{
        queued: number;
        embeddingsQueued?: number;
      }>(`/api/v1/companies/${location.company}/search/reindex`, post());
      setNotice(
        result.queued || result.embeddingsQueued
          ? "Search indexing queued in the background."
          : "The current search index is up to date.",
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIndexing(false);
    }
  }

  return (
    <div
      className={`research-workspace ${library ? "library-open" : ""} ${location.filing ? "inspecting" : ""}`}
    >
      <header className="workspace-header">
        <div className="workspace-brand">
          <button
            className="icon-button"
            aria-label={
              library ? "Hide company library" : "Show company library"
            }
            aria-expanded={library}
            onClick={() => setLibrary(!library)}
          >
            ☰
          </button>
          <a href="/home">secThing</a>
          <span>Research workspace</span>
        </div>
        <button className="primary-button" onClick={() => setIntake(true)}>
          ＋ Add company
        </button>
      </header>
      {library && (
        <aside className="library-panel" aria-label="Company library">
          <div className="library-title">
            <h2>Library</h2>
            <span>{companies.length} companies</span>
          </div>
          <input
            aria-label="Filter company library"
            className="library-search"
            placeholder="Find in your library…"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
          />
          <div className="company-scroll">
            {visibleCompanies.length ? (
              visibleCompanies.map((company) => (
                <button
                  className={`library-company ${String(company.id) === location.company ? "selected" : ""}`}
                  key={company.id}
                  onClick={() => openCompany(String(company.id))}
                >
                  <div>
                    <strong>{company.tickers[0] ?? "Issuer"}</strong>
                    <span
                      className={
                        ["running", "pending"].includes(
                          company.ingestion_status ?? "",
                        )
                          ? "processing-dot"
                          : ""
                      }
                    />
                  </div>
                  <span>{company.legal_name}</span>
                  <small>CIK {String(company.cik).padStart(10, "0")}</small>
                </button>
              ))
            ) : (
              <div className="empty-panel">
                <p>
                  {libraryQuery
                    ? "No companies match this filter."
                    : "Your library is empty."}
                </p>
                {!libraryQuery && (
                  <button onClick={() => setIntake(true)}>
                    Add your first company
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="library-footer">SEC filings, preserved locally</div>
        </aside>
      )}
      <main className="workspace-main">
        {!location.company ? (
          <div className="workspace-welcome">
            <span className="welcome-symbol">≋</span>
            <h1>Your evidence, in one place.</h1>
            <p>
              Choose a company from your library to browse its filings, search
              disclosures, and compare original sources with extracted text.
            </p>
            <button className="primary-button" onClick={() => setIntake(true)}>
              Add a company
            </button>
            <small>Local-first research. Not investment advice.</small>
          </div>
        ) : (
          <>
            <header className="company-toolbar">
              <div>
                <h1>{detail?.company.legal_name ?? "Loading company…"}</h1>
                <span>
                  {detail?.company.sic_description ?? "SEC issuer"}
                  {detail?.company.earliest_requested_filing_date
                    ? ` · Since ${dateLabel(detail.company.earliest_requested_filing_date)}`
                    : ""}
                </span>
              </div>
              <div className="coverage">
                <strong>
                  {detail?.search.chunks ?? 0}
                  <small>indexed passages</small>
                </strong>
                <strong>
                  {detail?.search.embedded ?? 0}
                  <small>meaning-ready</small>
                </strong>
                {processing > 0 && (
                  <span className="processing-label">
                    <i />
                    Processing {processing} job{processing === 1 ? "" : "s"}
                  </span>
                )}
                <button onClick={() => void reindex()} disabled={indexing}>
                  {indexing ? "Queueing…" : "Update index"}
                </button>
              </div>
            </header>
            <form
              className="search-toolbar"
              onSubmit={(event) => {
                event.preventDefault();
                navigate({
                  q: query.trim(),
                  filing: "",
                  hash: "",
                  start: "",
                  end: "",
                });
                rerunSearch();
              }}
            >
              <div className="query-input">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label="Search company evidence"
                  placeholder="Search disclosures, risks, business changes…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  minLength={2}
                />
                <button
                  className="primary-button"
                  disabled={searching || query.trim().length < 2}
                >
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
              <select
                aria-label="Search mode"
                value={location.mode}
                onChange={(event) => navigate({ mode: event.target.value })}
              >
                <option value="full_text">Keyword</option>
                <option value="semantic" disabled={!detail?.search.configured}>
                  Meaning
                </option>
                <option value="hybrid" disabled={!detail?.search.configured}>
                  Combined
                </option>
              </select>
              {location.q && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    navigate({
                      q: "",
                      filing: "",
                      hash: "",
                      start: "",
                      end: "",
                    });
                  }}
                >
                  Clear search
                </button>
              )}
            </form>
            <div className="filter-toolbar">
              <select
                aria-label="Form filter"
                value={location.formType}
                onChange={(e) => navigate({ formType: e.target.value })}
              >
                <option value="">All forms</option>
                {[...new Set(detail?.filings.map((f) => f.form_type) ?? [])]
                  .sort()
                  .map((form) => (
                    <option key={form}>{form}</option>
                  ))}
              </select>
              <label>
                From
                <input
                  aria-label="Filed after"
                  type="date"
                  value={location.filedAfter}
                  onChange={(e) => navigate({ filedAfter: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  aria-label="Filed before"
                  type="date"
                  value={location.filedBefore}
                  onChange={(e) => navigate({ filedBefore: e.target.value })}
                />
              </label>
              {location.q ? (
                <select
                  aria-label="Section filter"
                  value={location.sectionType}
                  onChange={(e) => navigate({ sectionType: e.target.value })}
                >
                  <option value="">All sections</option>
                  {[
                    "business",
                    "risk_factors",
                    "management_discussion",
                    "financial_statements",
                    "legal_proceedings",
                    "unknown",
                  ].map((section) => (
                    <option key={section} value={section}>
                      {section.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  aria-label="Evidence status filter"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                >
                  <option value="">All evidence states</option>
                  <option value="ready">Searchable</option>
                  <option value="pending">Processing / pending</option>
                  <option value="warning">Needs attention</option>
                  <option value="muted">Catalogue only</option>
                </select>
              )}
              <span>
                {detail?.search.configured
                  ? `${detail.search.model} · ${detail.search.pending} jobs pending${detail.search.failed ? ` · ${detail.search.failed} failed (Update index to retry)` : ""}`
                  : "Meaning search is off. Keyword search remains available."}
              </span>
            </div>
            {(error || notice || searchNote) && (
              <div
                className={`workspace-notice ${error ? "error" : ""}`}
                role={error ? "alert" : "status"}
              >
                <span>{error || searchNote || notice}</span>
                <button
                  aria-label="Dismiss notification"
                  onClick={() => {
                    setError("");
                    setNotice("");
                    setSearchNote("");
                  }}
                >
                  ×
                </button>
              </div>
            )}
            <div className="evidence-layout">
              <section
                className="results-panel"
                aria-label={location.q ? "Search results" : "Filing library"}
              >
                <header>
                  <div>
                    <h2>{location.q ? "Search results" : "Filings"}</h2>
                    <span>
                      {location.q
                        ? `${hits.length} passage${hits.length === 1 ? "" : "s"} in ${groups.length} filing${groups.length === 1 ? "" : "s"}`
                        : `${filtered.length} filings`}
                    </span>
                  </div>
                  {location.filing && (
                    <button
                      aria-label="Return to filing list"
                      onClick={() =>
                        navigate({ filing: "", hash: "", start: "", end: "" })
                      }
                    >
                      Expand list
                    </button>
                  )}
                </header>
                <div className="results-scroll" ref={resultsPane}>
                  {!detail ? (
                    <div className="empty-panel">
                      Loading your filing library…
                    </div>
                  ) : location.q ? (
                    searching ? (
                      <div className="empty-panel">
                        Searching preserved evidence…
                      </div>
                    ) : groups.length ? (
                      groups.map((group) => (
                        <section key={group[0].filing_id} className="hit-group">
                          <h3>
                            <span className="form-tag">
                              {group[0].form_type}
                            </span>
                            {dateLabel(group[0].filing_date)}
                            <small>
                              {group.length} passage
                              {group.length === 1 ? "" : "s"}
                            </small>
                          </h3>
                          {group.map((hit) => (
                            <button
                              key={hit.chunk_id}
                              className={`search-hit ${hit === selectedHit ? "selected" : ""}`}
                              onClick={() => openHit(hit)}
                            >
                              <strong>{hit.section_label}</strong>
                              <p>
                                <Snippet text={hit.snippet} />
                              </p>
                              <small>
                                Open passage <span aria-hidden="true">↗</span>
                              </small>
                            </button>
                          ))}
                        </section>
                      ))
                    ) : (
                      <div className="empty-panel">
                        <h3>No passages found.</h3>
                        <p>
                          {searchNote ||
                            "Try a broader query or remove filters. Only indexed evidence is searchable."}
                        </p>
                      </div>
                    )
                  ) : filtered.length ? (
                    filtered.map((filing, index) => {
                      const status = filingState(filing),
                        year = dateLabel(filing.filing_date).slice(0, 4);
                      return (
                        <div key={filing.id}>
                          {(index === 0 ||
                            year !==
                              dateLabel(filtered[index - 1].filing_date).slice(
                                0,
                                4,
                              )) && <h3 className="year-heading">{year}</h3>}
                          <div
                            className={`filing-row ${String(filing.id) === location.filing ? "selected" : ""}`}
                          >
                            <button
                              className="filing-select"
                              onClick={() => openFiling(filing)}
                            >
                              <span className="form-tag">
                                {filing.form_type}
                              </span>
                              <div>
                                <strong>{dateLabel(filing.filing_date)}</strong>
                                <span>
                                  {filing.report_date
                                    ? `Period ending ${dateLabel(filing.report_date)}`
                                    : filing.accession_number}
                                </span>
                              </div>
                              <span className={`evidence-badge ${status.tone}`}>
                                {status.label}
                              </span>
                            </button>
                            {filing.is_supported &&
                              (filing.last_error || !filing.chunk_count) && (
                                <button
                                  className="filing-work-action"
                                  onClick={() => void queue(filing)}
                                >
                                  {filing.last_error
                                    ? "Retry processing"
                                    : filing.source_status === "downloaded"
                                      ? "Process evidence"
                                      : "Acquire source"}
                                </button>
                              )}
                            {filing.last_error && (
                              <p className="filing-error">
                                {filing.last_error}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="empty-panel">
                      <h3>No filings in this view.</h3>
                      <p>
                        Adjust the filters, or wait for company processing to
                        discover filings.
                      </p>
                    </div>
                  )}
                </div>
              </section>
              {location.filing && (
                <DocumentReader
                  filing={selectedFiling}
                  reader={reader}
                  error={readerError}
                  hit={selectedHit}
                  start={location.start ? Number(location.start) : undefined}
                  end={location.end ? Number(location.end) : undefined}
                  onClose={() =>
                    navigate({ filing: "", hash: "", start: "", end: "" })
                  }
                  onNext={nextHit}
                  hasHits={hits.length > 0}
                />
              )}
            </div>
          </>
        )}
      </main>
      {intake && (
        <AddCompany
          onClose={() => setIntake(false)}
          onOpen={openCompany}
          onQueued={refresh}
        />
      )}
    </div>
  );
}
