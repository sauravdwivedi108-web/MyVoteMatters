import { Database, PlugZap, RefreshCw } from 'lucide-react';
import { Brand } from './Brand';
import { databaseEnvNames } from '@/lib/pool';

export function SetupNeeded() {
  const names = databaseEnvNames();
  return (
    <div className="auth-wrap">
      <div className="card auth-card" style={{ maxWidth: 520 }}>
        <Brand />
        <h1 className="h-icon"><Database size={24} aria-hidden="true" />Connect a database</h1>
        <p className="muted">The site is live. It needs a PostgreSQL database before anyone can sign in. This is a one-time step in Vercel.</p>
        <ol className="setup-steps">
          <li><span className="n"><Database size={16} aria-hidden="true" /></span>
            <span>In your Vercel project, open the <strong>Storage</strong> tab, click <strong>Create Database</strong> and choose <strong>Neon</strong> (free plan is fine).</span></li>
          <li><span className="n"><PlugZap size={16} aria-hidden="true" /></span>
            <span>Click <strong>Connect</strong> to link it to this project, with all environments ticked. Vercel adds the database address automatically.</span></li>
          <li><span className="n"><RefreshCw size={16} aria-hidden="true" /></span>
            <span>Open <strong>Deployments</strong>, click <strong>⋯</strong> on the latest one and choose <strong>Redeploy</strong>. Tables are created on first use.</span></li>
        </ol>
        <div className="notice info small">
          <strong>What this deployment can see:</strong>{' '}
          {names.length
            ? <>database-related settings named <code>{names.join(', ')}</code>, but none holds a postgres:// address.</>
            : <>no database settings at all. Either the database is not connected to this project yet, or the site has not been redeployed since connecting it.</>}
        </div>
      </div>
    </div>
  );
}
