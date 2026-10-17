import Link from 'next/link';
import {
  Fingerprint, History, ListChecks, Users, KeyRound, Radio, BarChart3, ArrowRight, CheckCircle2, ShieldCheck,
  Lock, FileSpreadsheet, Scale, UserRound, Building2, Landmark, Gavel, EyeOff,
} from 'lucide-react';
import { SiteNav, SiteFooter } from '@/components/SiteChrome';

const steps = [
  [ListChecks, 'Set the questions', 'Topics with options and full descriptions, how many choices each voter may make, and the approval threshold.'],
  [Users, 'Add the voters', 'Shareholders or creditors with their voting weight. Paste straight from Excel; each % share is calculated for you.'],
  [KeyRound, 'Issue voter IDs', 'One login ID and password per voter. Download the sheet or print slips to hand out.'],
  [Radio, 'Voters vote', 'They log in on any phone, answer one question at a time, review and confirm. You watch turnout live.'],
  [BarChart3, 'Results and report', 'Approval against the threshold, % of total share, who voted for what, and a CSV and printable report.'],
] as const;

const controls = [
  [Fingerprint, 'One ID, one vote', 'Enforced inside the database. Repeated or simultaneous attempts still record exactly one vote.'],
  [Lock, 'Frozen before voting', 'Questions and the voter list are locked, with a fingerprint recorded, before anyone can vote.'],
  [EyeOff, 'No early peeking', 'While voting is open you see who has voted, never what they chose. Choices unlock when voting ends.'],
  [Scale, 'Weighted, threshold-based', 'Each vote carries the voter’s share. Approval is measured against the whole roll, e.g. 66% of the committee.'],
  [History, 'Hash-chained audit log', 'Every action is chained to the one before it, so altering history is detected automatically.'],
  [ShieldCheck, 'Passwords never stored', 'Voter passwords and admin passwords are kept only as one-way hashes.'],
] as const;

export default function Home() {
  return (
    <>
      <div className="hero">
        <SiteNav />
        <div className="hero-inner">
          <div>
            <p className="eyebrow"><Landmark size={14} aria-hidden="true" /> Insolvency and shareholder e-voting</p>
            <h1>Every vote recorded, weighted and audit-ready.</h1>
            <p className="lead">
              MyVoteMatters lets an administrator put questions to shareholders and creditors of a company, issue each voter a secure login,
              and produce results with a complete, verifiable record of who voted for what.
            </p>
            <div className="hero-ctas">
              <Link href="/login" className="btn"><Building2 size={18} aria-hidden="true" /> Admin login</Link>
              <Link href="/voter" className="btn light"><UserRound size={18} aria-hidden="true" /> Voter login</Link>
            </div>
            <p className="small" style={{ color: '#aab3cc', marginTop: 14 }}>New organisation? <Link href="/signup" style={{ color: '#fff' }}>Create an admin account</Link></p>
          </div>
          <div className="hero-card" aria-label="Example result">
            <div className="small" style={{ color: '#c9cfe3' }}>Example · 7th CoC meeting · Question 1: Which resolution plan? · needs 66% of total share</div>
            <div className="res">
              <div className="hero-opt">
                <div><strong>Plan by Applicant A</strong><span className="h-icon" style={{ color: 'var(--teal-strong)', gap: 4 }}><CheckCircle2 size={16} aria-hidden="true" /> Approved</span></div>
                <div className="meter"><span style={{ width: '78.75%' }} /><i className="meter-mark" style={{ left: '66%' }} /></div>
                <div className="small muted num">78.75% of total share · 2 voters</div>
              </div>
              <div className="hero-opt">
                <div><strong>Plan by Applicant B</strong><span className="small muted">Not approved</span></div>
                <div className="meter"><span style={{ width: '15%' }} /><i className="meter-mark" style={{ left: '66%' }} /></div>
                <div className="small muted num">15.00% of total share · 1 voter</div>
              </div>
            </div>
            <div className="res small hero-table">
              <div className="hero-head"><span>Creditor</span><span>Share</span><span>Voted for</span></div>
              <div><span>State Bank of India</span><span>56.25%</span><span>Plan A</span></div>
              <div><span>Axis Bank</span><span>22.50%</span><span>Plan A</span></div>
              <div><span>Edelweiss ARC</span><span>15.00%</span><span>Plan B</span></div>
              <div className="muted"><span>Operational creditors</span><span>6.25%</span><span>Did not vote</span></div>
            </div>
            <div className="small h-icon" style={{ color: '#8fe3d8', marginTop: 12, gap: 6 }}><Lock size={15} aria-hidden="true" /> One voter ID, one vote: a second attempt is refused.</div>
            <div className="small h-icon" style={{ color: '#8fe3d8', marginTop: 6, gap: 6 }}><ShieldCheck size={15} aria-hidden="true" /> Audit chain verified · 23 entries</div>
          </div>
        </div>
      </div>

      <section className="section" id="how">
        <p className="kicker">How it works</p>
        <h2>From questions to a signed-off result in five steps</h2>
        <ol className="flow big">
          {steps.map(([Icon, title, body], i) => (
            <li key={title}>
              <span className="flow-n">{i + 1}</span>
              <span className="flow-icon" aria-hidden="true"><Icon size={22} /></span>
              <strong>{title}</strong>
              <span>{body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="section band" id="trust">
        <p className="kicker">Built for scrutiny</p>
        <h2>Controls an auditor can check</h2>
        <p className="muted" style={{ maxWidth: 680 }}>The rules are enforced by the database itself, not just the screen, so they hold even if someone bypasses the website.</p>
        <div className="features">
          {controls.map(([Icon, title, body]) => (
            <div className="feature" key={title}>
              <div className="icon" aria-hidden="true"><Icon size={20} /></div>
              <h3>{title}</h3>
              <p className="muted small" style={{ margin: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="grid-2">
          <div className="card role-card">
            <span className="role-icon" aria-hidden="true"><Gavel size={22} /></span>
            <h3>For administrators</h3>
            <p className="muted small">Resolution professionals, company secretaries and liquidators set up the meeting, issue IDs, run the vote and download the report.</p>
            <Link href="/login" className="btn">Admin login <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
          <div className="card role-card">
            <span className="role-icon teal" aria-hidden="true"><UserRound size={22} /></span>
            <h3>For voters</h3>
            <p className="muted small">Shareholders and creditors log in with the voter ID and password from the administrator. No app or account needed.</p>
            <Link href="/voter" className="btn teal">Voter login <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 22, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <FileSpreadsheet size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
          Pilot software: not yet independently certified. Confirm voting thresholds and procedure for each proceeding with your legal advisor.
        </p>
      </section>
      <SiteFooter />
    </>
  );
}
