'use client';

import { useState, useTransition } from 'react';
import type { FormState } from '@/lib/actions';
import { Notice } from './forms';

function download(name: string, content: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/** Approval hands the tally key over exactly once. */
export function ApprovePanel({ action, title }: { action: () => Promise<FormState & { key?: string }>; title: string }) {
  const [state, setState] = useState<FormState & { key?: string }>();
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const fileName = `tally-key-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pem`;

  if (state?.key) {
    return (
      <div>
        <div className="notice warn" role="alert">
          <strong>Save this tally key now.</strong> It is shown only once and MyVoteMatters does not keep a copy.
          Without it the ballots can never be counted. Keep it with your scrutinizer, offline.
        </div>
        <div className="keybox">{state.key}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => { download(fileName, state.key!); setSaved(true); }}>Download key file</button>
          {saved && <button className="btn secondary" onClick={() => location.reload()}>I have saved it, continue</button>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <Notice state={state} />
      <button className="btn teal" disabled={pending} onClick={() => {
        if (!confirm('Approve this election? The voter roll, ballot and dates will be locked, and you will receive the tally key.')) return;
        start(async () => setState(await action()));
      }}>{pending ? 'Approving…' : 'Approve and lock'}</button>
    </div>
  );
}

/** Voting links are shown once; only hashes of their secrets are stored. */
export function InvitePanel({ action, title }: { action: () => Promise<FormState & { links?: { ref: string; url: string }[] }>; title: string }) {
  const [state, setState] = useState<FormState & { links?: { ref: string; url: string }[] }>();
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string>();
  const links = state?.links ?? [];
  const csv = 'reference,voting_link\n' + links.map((l) => `${l.ref},${l.url}`).join('\n');

  return (
    <div>
      <Notice state={state} />
      {links.length > 0 ? (
        <>
          <div className="notice warn">
            These links are shown only once. Download the file and send each voter their own link privately
            (email, SMS or letter). Anyone holding a link can vote with it.
          </div>
          <button className="btn" onClick={() => download(`voting-links-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, csv, 'text/csv')}>
            Download {links.length} links (CSV)
          </button>
          <div className="table-wrap" style={{ marginTop: 14, maxHeight: 280, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Reference</th><th>Link</th></tr></thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.ref}>
                    <td className="mono">{l.ref}</td>
                    <td>
                      <button className="btn secondary small" onClick={() => { navigator.clipboard.writeText(l.url); setCopied(l.ref); }}>
                        {copied === l.ref ? 'Copied' : 'Copy link'}
                      </button>{' '}
                      <a href={l.url} target="_blank" rel="noreferrer" className="small">Open</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <button className="btn" disabled={pending} onClick={() => start(async () => setState(await action()))}>
          {pending ? 'Creating links…' : 'Create voting links'}
        </button>
      )}
    </div>
  );
}
