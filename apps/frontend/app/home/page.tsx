import Link from "next/link";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { SystemStatus } from "../system-status";

export default function HomePage() {
  return (
    <main className="site-shell home-shell">
      <SiteHeader active="home" />
      <div className="home-content">
        <section className="intro" aria-labelledby="page-title">
          <p className="section-label">SEC filings, made inspectable</p>
          <h1 id="page-title">Begin with the record.</h1>
          <p className="lede">A local workspace for building an evidence bank from public-company disclosures.</p>
        </section>
        <SystemStatus />
        <Link className="record-entry" href="/records">Enter the records</Link>
      </div>
      <SiteFooter />
    </main>
  );
}
