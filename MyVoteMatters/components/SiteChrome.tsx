import Link from 'next/link';
import { Brand } from './Brand';
import { Building2, UserRound } from 'lucide-react';

export function SiteNav() {
  return (
    <header className="site-nav">
      <Brand />
      <nav aria-label="Main">
        <Link className="link hide-sm" href="/#how">How it works</Link>
        <Link className="link hide-sm" href="/#trust">Controls</Link>
        <Link className="link h-icon" style={{ gap: 6 }} href="/voter"><UserRound size={16} aria-hidden="true" />Voter login</Link>
        <Link className="btn small" href="/login"><Building2 size={16} aria-hidden="true" />Admin login</Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="section">
        <span>© {new Date().getFullYear()} MyVoteMatters. Pilot software, not yet independently certified.</span>
        <span><Link href="/security">Security</Link> · <Link href="/voter">Voter login</Link> · <Link href="/login">Admin login</Link></span>
      </div>
    </footer>
  );
}
