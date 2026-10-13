'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/actions';
import type { BallotDefinition } from '@/lib/core/ballot';
import { Notice, Submit } from './forms';

type Res = { id: string; title: string; text: string; majority: 'ordinary' | 'special' };
type Cand = { id: string; name: string };

export function BallotBuilder({ kind, initial, action }: {
  kind: string; initial: BallotDefinition | null; action: (s: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const isRes = kind === 'agm_resolutions';
  const [resolutions, setRes] = useState<Res[]>(
    initial?.type === 'resolutions' ? initial.resolutions : [{ id: 'R1', title: '', text: '', majority: 'ordinary' }]);
  const [question, setQuestion] = useState(initial?.type === 'single_choice' ? initial.question : '');
  const [cands, setCands] = useState<Cand[]>(
    initial?.type === 'single_choice' ? initial.candidates : [{ id: 'C1', name: '' }, { id: 'C2', name: '' }]);

  const def: BallotDefinition = isRes
    ? { type: 'resolutions', resolutions: resolutions.map((r, i) => ({ ...r, id: `R${i + 1}`, title: r.title.trim(), text: r.text.trim() })) }
    : { type: 'single_choice', question: question.trim(), candidates: cands.map((c, i) => ({ id: `C${i + 1}`, name: c.name.trim() })) };

  const updRes = (i: number, patch: Partial<Res>) => setRes(resolutions.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form action={formAction}>
      <input type="hidden" name="definition" value={JSON.stringify(def)} />
      <Notice state={state} />
      {isRes ? (
        <>
          {resolutions.map((r, i) => (
            <div className="item" key={i}>
              <div className="item-head">
                <strong>Resolution {i + 1}</strong>
                {resolutions.length > 1 && (
                  <button type="button" className="btn ghost small" onClick={() => setRes(resolutions.filter((_, j) => j !== i))}>Remove</button>
                )}
              </div>
              <div className="field"><label htmlFor={`rt${i}`}>Title</label>
                <input id={`rt${i}`} type="text" value={r.title} onChange={(e) => updRes(i, { title: e.target.value })} placeholder="Adoption of audited financial statements" required /></div>
              <div className="field"><label htmlFor={`rx${i}`}>Resolution text</label>
                <textarea id={`rx${i}`} value={r.text} onChange={(e) => updRes(i, { text: e.target.value })} style={{ minHeight: 80 }}
                  placeholder="RESOLVED THAT the audited financial statements for the year ended 31 March 2026 be received and adopted." required /></div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`rm${i}`}>Majority required</label>
                <select id={`rm${i}`} value={r.majority} onChange={(e) => updRes(i, { majority: e.target.value as Res['majority'] })}>
                  <option value="ordinary">Ordinary: votes for exceed votes against</option>
                  <option value="special">Special: votes for at least 3× votes against</option>
                </select>
              </div>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={() => setRes([...resolutions, { id: '', title: '', text: '', majority: 'ordinary' }])}>
            + Add resolution
          </button>
        </>
      ) : (
        <>
          <div className="field"><label htmlFor="q">Question</label>
            <input id="q" type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Who should chair the board?" required /></div>
          {cands.map((c, i) => (
            <div className="field" key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor={`c${i}`}>Option {i + 1}</label>
                <input id={`c${i}`} type="text" value={c.name} onChange={(e) => setCands(cands.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} required />
              </div>
              {cands.length > 2 && <button type="button" className="btn ghost small" onClick={() => setCands(cands.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={() => setCands([...cands, { id: '', name: '' }])}>+ Add option</button>
        </>
      )}
      <div style={{ marginTop: 18 }}><Submit pendingText="Saving…">Save ballot</Submit></div>
    </form>
  );
}
