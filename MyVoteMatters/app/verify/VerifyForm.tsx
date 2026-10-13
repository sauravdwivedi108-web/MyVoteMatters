'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';

export function VerifyForm() {
  const q = useSearchParams();
  const [result, setResult] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const org = q.get('o') ?? '';
  const election = q.get('e') ?? '';

  async function check(fd: FormData) {
    setBusy(true);
    const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ org, election, receipt: String(fd.get('receipt') ?? '').toLowerCase() }) });
    setResult((await r.json()).found);
    setBusy(false);
  }

  if (!org || !election) {
    return <div className="notice info">Open this page from the “Check my receipt” button shown after voting, so we know which election to check.</div>;
  }
  return (
    <form action={check} className="card">
      <div className="field">
        <label htmlFor="receipt">Receipt code</label>
        <input id="receipt" name="receipt" type="text" className="mono" defaultValue={q.get('r') ?? ''} required pattern="[0-9a-fA-F]{24}" />
      </div>
      <button className="btn" disabled={busy}>{busy ? 'Checking…' : 'Check receipt'}</button>
      {result === true && <div className="notice ok" role="status">✓ This receipt matches a ballot accepted into the ballot box.</div>}
      {result === false && <div className="notice error" role="alert">No accepted ballot matches this receipt for this election.</div>}
    </form>
  );
}
