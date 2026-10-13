import Link from 'next/link';
import { requireSession, can } from '@/lib/auth';
import { listElections } from '@/lib/queries';
import { ElectionTable } from '@/components/ElectionTable';
import { Plus } from 'lucide-react';

export const metadata = { title: 'Elections' };

export default async function Elections() {
  const s = await requireSession();
  const elections = await listElections(s);
  return (
    <>
      <div className="page-head">
        <h1>Elections</h1>
        {can(s, 'manage') && <Link className="btn" href="/app/elections/new"><Plus size={18} aria-hidden="true" /> New election</Link>}
      </div>
      <ElectionTable elections={elections} canCreate={can(s, 'manage')} />
    </>
  );
}
