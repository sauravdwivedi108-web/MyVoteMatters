const LABELS: Record<string, string> = {
  draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved', open: 'Voting open',
  closed: 'Closed', tallied: 'Counted', published: 'Published',
};
export const statusLabel = (s: string) => LABELS[s] ?? s;
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{statusLabel(status)}</span>;
}

const KIND: Record<string, string> = {
  agm_resolutions: 'AGM resolutions', board_election: 'Board election', internal_poll: 'Internal poll',
};
export const kindLabel = (k: string) => KIND[k] ?? k;

const fmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
export const ist = (d: Date | string) => `${fmt.format(new Date(d))} IST`;

export const units = (v: string | number | bigint) => {
  try { return BigInt(String(v)).toLocaleString('en-IN'); } catch { return String(v); }
};
