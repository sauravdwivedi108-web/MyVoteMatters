import { History, Lock, ShieldCheck } from 'lucide-react';
import { Brand } from './Brand';

/** Shared sign-in stage: a quiet chamber panel beside the form. */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <aside className="auth-aside">
        <Brand />
        <div>
          <p className="auth-aside-title">Every vote recorded, weighted and audit-ready.</p>
          <ul className="auth-points">
            <li><ShieldCheck size={18} aria-hidden="true" /> One ID, one vote</li>
            <li><Lock size={18} aria-hidden="true" /> Frozen before voting</li>
            <li><History size={18} aria-hidden="true" /> Hash-chained audit log</li>
          </ul>
        </div>
      </aside>
      <div className="auth-stage">{children}</div>
    </div>
  );
}
