import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { getElection } from '@/lib/queries';
import { LegacyElection } from '@/components/LegacyElection';
import { Meeting } from '@/components/meeting/Meeting';

export const metadata = { title: 'Meeting' };

export default async function MeetingPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const s = await requireSession();
  const e = await getElection(s, id);
  if (!e) notFound();
  if (e.kind !== 'creditor_vote') return <LegacyElection e={e} s={s} />;
  return <Meeting e={e} s={s} tab={tab ?? 'overview'} />;
}
