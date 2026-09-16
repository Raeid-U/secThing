import Link from "next/link";

export function SiteHeader({ active }: { active: "home" | "records" }) {
  return (
    <header className="masthead">
      <Link className="wordmark" href="/home">secThing</Link>
      <nav aria-label="Primary navigation">
        <Link className={active === "home" ? "is-active" : undefined} href="/home">Home</Link>
        <Link className={active === "records" ? "is-active" : undefined} href="/records">Records</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return <footer><span>Local-first SEC filing research</span><span>Not investment advice</span></footer>;
}
