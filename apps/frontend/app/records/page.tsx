import { CompanyWorkbench } from "../company-workbench";
import { SiteFooter, SiteHeader } from "../site-chrome";

export default function RecordsPage() {
  return (
    <main className="site-shell records-shell">
      <SiteHeader active="records" />
      <div className="records-content">
        <section className="records-intro" aria-labelledby="records-title">
          <p className="section-label">Company records</p>
          <h1 id="records-title">The filing library.</h1>
          <p className="lede">Add a ticker, choose its earliest filing date, and return here to inspect every company retained locally.</p>
        </section>
        <CompanyWorkbench />
      </div>
      <SiteFooter />
    </main>
  );
}
