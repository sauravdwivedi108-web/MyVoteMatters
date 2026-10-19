import Link from 'next/link';
import { SiteNav, SiteFooter } from '@/components/SiteChrome';

export default function NotFound() {
  return (
    <>
      <SiteNav />
      <main className="section doc narrow">
        <p className="kicker">404</p>
        <h1>Page not found</h1>
        <p className="muted">That address does not match a page in MyVoteMatters.</p>
        <div className="btn-row">
          <Link className="btn" href="/">Home</Link>
          <Link className="btn secondary" href="/voter">Voter login</Link>
          <Link className="btn secondary" href="/login">Admin login</Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
