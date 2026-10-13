import { notFound } from 'next/navigation';
import { SiteNav, SiteFooter } from '@/components/SiteChrome';
import { Results, Reconciliation } from '@/components/Results';
import { getPublishedResult } from '@/lib/queries';
import { ist, units, kindLabel } from '@/components/Status';
import { hasDatabase } from '@/lib/pool';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Published results' };

export default async function PublicResults({ params }: { params: Promise<{ org: string; election: string }> }) {
  const { org, election } = await params;
  if (!hasDatabase()) notFound();
  const r = await getPublishedResult(org, election);
  if (!r) notFound();
  return (
    <>
      <SiteNav />
      <main className="section" style={{ maxWidth: 860 }}>
        <div className="small muted">{r.org_name} · {kindLabel(r.kind)}</div>
        <h1>{r.title}: results</h1>
        <p className="muted">Counted {ist(r.completed_at)}. Turnout {r.turnout.voted} of {r.turnout.eligible} entitlements, {units(r.turnout.units_voted)} of {units(r.turnout.units_eligible)} voting units.</p>
        <div className="card">
          <Reconciliation result={r.result} resultHash={r.result_hash} />
          <Results definition={r.definition} result={r.result} />
        </div>
        <p className="small muted" style={{ marginTop: 16 }}>Individual choices are never shown. This is a secret ballot.</p>
      </main>
      <SiteFooter />
    </>
  );
}
