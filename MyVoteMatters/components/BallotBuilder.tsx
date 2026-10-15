'use client';

import { useActionState, useState } from 'react';
import type { FormState } from '@/lib/actions';
import { picksLabel, type BallotDefinition } from '@/lib/core/ballot';
import { Notice, Submit } from './forms';

type Res = { id: string; title: string; text: string; majority: 'ordinary' | 'special' };
type Opt = { name: string; detail: string };
type Item = { title: string; description: string; options: Opt[]; minChoices: number; maxChoices: number; threshold: string };

const blankItem = (threshold = ''): Item => ({ title: '', description: '', options: [{ name: '', detail: '' }, { name: '', detail: '' }], minChoices: 1, maxChoices: 1, threshold });

function initialItems(initial: BallotDefinition | null, threshold: string): Item[] {
  if (initial?.type === 'agenda') {
    return initial.items.map((it) => ({
      title: it.title, description: it.description, minChoices: it.minChoices, maxChoices: it.maxChoices,
      threshold: it.thresholdPct === undefined ? '' : String(it.thresholdPct),
      options: it.options.map((o) => ({ name: o.name, detail: o.detail ?? '' })),
    }));
  }
  if (initial?.type === 'single_choice') {
    return [{ ...blankItem(threshold), title: initial.question, options: initial.candidates.map((c) => ({ name: c.name, detail: '' })) }];
  }
  return [blankItem(threshold)];
}

export function BallotBuilder({ kind, initial, action }: {
  kind: string; initial: BallotDefinition | null; action: (s: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const isRes = kind === 'agm_resolutions';
  const [resolutions, setRes] = useState<Res[]>(
    initial?.type === 'resolutions' ? initial.resolutions : [{ id: 'R1', title: '', text: '', majority: 'ordinary' }]);
  const creditor = kind === 'creditor_vote';
  const [items, setItems] = useState<Item[]>(() => initialItems(initial, creditor ? '66' : ''));

  const def: BallotDefinition = isRes
    ? { type: 'resolutions', resolutions: resolutions.map((r, i) => ({ ...r, id: `R${i + 1}`, title: r.title.trim(), text: r.text.trim() })) }
    : {
        type: 'agenda',
        items: items.map((it, i) => ({
          id: `A${i + 1}`, title: it.title.trim(), description: it.description.trim(),
          options: it.options.map((o, j) => ({ id: `O${j + 1}`, name: o.name.trim(), ...(o.detail.trim() ? { detail: o.detail.trim() } : {}) })),
          minChoices: it.minChoices, maxChoices: it.maxChoices,
          ...(it.threshold.trim() ? { thresholdPct: Number(it.threshold) } : {}),
        })),
      };

  const updItem = (i: number, patch: Partial<Item>) => setItems(items.map((it, j) => {
    if (j !== i) return it;
    const next = { ...it, ...patch };
    // Keep the pick rule valid as options are added or removed.
    next.maxChoices = Math.max(1, Math.min(next.maxChoices, next.options.length));
    next.minChoices = Math.max(0, Math.min(next.minChoices, next.maxChoices));
    return next;
  }));
  const updOpt = (i: number, j: number, patch: Partial<Opt>) =>
    updItem(i, { options: items[i].options.map((o, k) => (k === j ? { ...o, ...patch } : o)) });

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
          <p className="small muted" style={{ marginTop: 0 }}>
            Add an agenda item for each decision, for example each board position. For every item you decide the options and how many of them a voter may pick.
          </p>
          {items.map((it, i) => (
            <div className="item" key={i}>
              <div className="item-head">
                <strong>Agenda item {i + 1}</strong>
                {items.length > 1 && (
                  <button type="button" className="btn ghost small" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove item</button>
                )}
              </div>
              <div className="field"><label htmlFor={`at${i}`}>Title</label>
                <input id={`at${i}`} type="text" value={it.title} onChange={(e) => updItem(i, { title: e.target.value })}
                  placeholder="Election of independent directors" required /></div>
              <div className="field"><label htmlFor={`ad${i}`}>Description <span className="hint">optional</span></label>
                <textarea id={`ad${i}`} value={it.description} onChange={(e) => updItem(i, { description: e.target.value })} style={{ minHeight: 60 }}
                  placeholder="Three seats are open. Choose up to three candidates." /></div>
              <fieldset className="field" style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
                <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Options</legend>
                {it.options.map((o, j) => (
                  <div key={j} className="opt-row">
                    <span className="small muted opt-n">{j + 1}</span>
                    <input aria-label={`Option ${j + 1} name`} id={`ao${i}-${j}`} type="text" value={o.name}
                      onChange={(e) => updOpt(i, j, { name: e.target.value })} placeholder={creditor ? 'e.g. Resolution plan by X Ltd' : 'Name'} required />
                    {it.options.length > 2 ? (
                      <button type="button" className="btn ghost small" aria-label={`Remove option ${j + 1}`}
                        onClick={() => updItem(i, { options: it.options.filter((_, k) => k !== j) })}>Remove</button>
                    ) : <span />}
                    <textarea aria-label={`Option ${j + 1} description`} className="opt-desc" value={o.detail}
                      onChange={(e) => updOpt(i, j, { detail: e.target.value })}
                      placeholder={creditor ? 'Description (optional): amount offered, payment timeline, key terms' : 'Description (optional), e.g. DIN, experience'} />
                  </div>
                ))}
                <button type="button" className="btn secondary small" onClick={() => updItem(i, { options: [...it.options, { name: '', detail: '' }] })}>+ Add option</button>
              </fieldset>
              <div className="opt-rule">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`amax${i}`}>Most a voter can pick</label>
                  <input id={`amax${i}`} type="number" min={1} max={it.options.length} value={it.maxChoices}
                    onChange={(e) => updItem(i, { maxChoices: Number(e.target.value) || 1 })} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`amin${i}`}>Fewest a voter must pick</label>
                  <input id={`amin${i}`} type="number" min={0} max={it.maxChoices} value={it.minChoices}
                    onChange={(e) => updItem(i, { minChoices: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="field" style={{ margin: '12px 0 0', maxWidth: 360 }}>
                <label htmlFor={`ath${i}`}>Approval threshold <span className="hint">% of total voting share, optional</span></label>
                <input id={`ath${i}`} type="number" min={1} max={100} step="0.01" value={it.threshold}
                  onChange={(e) => updItem(i, { threshold: e.target.value })} placeholder="e.g. 66 for a resolution plan, 51 for other decisions" />
              </div>
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                Voters see: <strong>{picksLabel(it.minChoices, it.maxChoices)}</strong>.{' '}
                {it.threshold.trim()
                  ? <>An option is approved only with at least {it.threshold}% of the total voting share; the top {it.maxChoices} of those {it.maxChoices === 1 ? 'is' : 'are'} selected.</>
                  : <>The top {it.maxChoices} {it.maxChoices === 1 ? 'option wins' : 'options win'}.</>}
              </p>
            </div>
          ))}
          <button type="button" className="btn secondary small" onClick={() => setItems([...items, blankItem(creditor ? '66' : '')])}>+ Add agenda item</button>
        </>
      )}
      <div style={{ marginTop: 18 }}><Submit pendingText="Saving…">Save ballot</Submit></div>
    </form>
  );
}
