import { CompanyWorkbench } from "../company-workbench";
import { SiteFooter, SiteHeader } from "../site-chrome";

export default function RecordsPage() {
  return (
    <main className="site-shell records-shell">
      <SiteHeader active="records" />
      <div className="records-content">
        <section className="records-intro" aria-labelledby="records-title">
          <p className="section-label">Research records</p>
          <h1 id="records-title">Companies and filings</h1>
          <p className="lede">Add a company, track its evidence state, and inspect its preserved filing text.</p>
        </section>
        <CompanyWorkbench />
      </div>
      <SiteFooter />
    </main>
  );
}
