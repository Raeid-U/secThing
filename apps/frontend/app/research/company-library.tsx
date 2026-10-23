import type { Company } from "./types";

type SharedProps = {
  companies: Company[];
  onAdd: () => void;
  onOpen: (id: string) => void;
};

export function CompanyLibrary({
  companies,
  selectedId,
  query,
  onQuery,
  onAdd,
  onOpen,
}: SharedProps & {
  selectedId: string;
  query: string;
  onQuery: (value: string) => void;
}) {
  const visible = companies.filter((company) =>
    `${company.legal_name} ${company.tickers.join(" ")}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <aside className="library-panel" aria-label="Company library">
      <div className="library-title"><h2>Companies</h2><span>{companies.length} companies</span></div>
      <input
        aria-label="Filter company library"
        className="library-search"
        placeholder="Find a company"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <div className="company-scroll">
        {visible.length ? visible.map((company) => (
          <button
            className={`library-company ${String(company.id) === selectedId ? "selected" : ""}`}
            key={company.id}
            onClick={() => onOpen(String(company.id))}
          >
            <div>
              <strong>{company.tickers[0] ?? "Issuer"}</strong>
              <span className={["running", "pending"].includes(company.ingestion_status ?? "") ? "processing-dot" : ""} />
            </div>
            <span>{company.legal_name}</span>
            <small>
              CIK {String(company.cik).padStart(10, "0")}
              {company.ingestion_status && company.ingestion_status !== "complete"
                ? ` · ${company.ingestion_status.replaceAll("_", " ")}` : ""}
            </small>
          </button>
        )) : (
          <div className="empty-panel">
            <p>{query ? "No companies match this filter." : "Your library is empty."}</p>
            {!query && <button onClick={onAdd}>Add your first company</button>}
          </div>
        )}
      </div>
      <div className="library-footer">Sources stay in your local library</div>
    </aside>
  );
}

export function LibraryHome({ companies, onAdd, onOpen }: SharedProps) {
  return (
    <section className="library-home" aria-labelledby="library-heading">
      <header className="library-home-heading">
        <div>
          <p>SEC evidence, organized for research</p>
          <h1 id="library-heading">Your company library</h1>
          <span>Open a company to search disclosures and inspect every result against its source.</span>
        </div>
        <button className="primary-button" onClick={onAdd}>Add a company</button>
      </header>
      {companies.length ? (
        <div className="library-home-list" aria-label="Company library">
          {companies.map((company) => (
            <button key={company.id} className="library-home-row" onClick={() => onOpen(String(company.id))}>
              <span className="company-monogram" aria-hidden="true">{(company.tickers[0] ?? company.legal_name).slice(0, 2)}</span>
              <span className="company-identity">
                <strong>{company.legal_name}</strong>
                <small>{company.tickers.join(", ") || "SEC issuer"} · CIK {String(company.cik).padStart(10, "0")}</small>
              </span>
              <span className={`row-status ${["running", "pending"].includes(company.ingestion_status ?? "") ? "pending" : "ready"}`}>
                {["running", "pending"].includes(company.ingestion_status ?? "") ? "Building evidence" : "Open research"}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="library-empty">
          <h2>Start with a company you want to understand.</h2>
          <p>Enter its ticker, choose how much history to collect, and begin reading while the evidence library builds.</p>
          <button className="text-button" onClick={onAdd}>Add your first company</button>
        </div>
      )}
      <footer className="library-note"><span>Local-first by design</span><span>Evidence before synthesis</span><span>Not investment advice</span></footer>
    </section>
  );
}
