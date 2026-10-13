import { SiteNav, SiteFooter } from '@/components/SiteChrome';

export const metadata = { title: 'Security' };

export default function Security() {
  return (
    <>
      <SiteNav />
      <main className="section prose">
        <h1>How MyVoteMatters protects a vote</h1>
        <p className="muted">A plain account of what is enforced today and what is not yet.</p>

        <h2>Two jobs kept apart</h2>
        <p>An election must check that the right person votes once, and it must stop anyone learning how they voted. MyVoteMatters keeps those jobs in separate database roles:</p>
        <ul>
          <li>The <strong>application role</strong> manages elections and voter eligibility. It has no permission to read ballots.</li>
          <li>The <strong>counting role</strong> can read encrypted ballots, and only after voting closes. It has no permission to read the voter roll.</li>
          <li>Ballots carry no voter reference, no timestamp and no sequence number, so there is nothing to join them on.</li>
        </ul>

        <h2>Encryption</h2>
        <p>Each ballot is encrypted (X25519, HKDF-SHA256, AES-256-GCM) to a key created when the election is approved. The private key is handed once to the approver and never stored by MyVoteMatters. Ballots are padded to a fixed size so their length reveals nothing.</p>

        <h2>Voting links and receipts</h2>
        <p>Each voter gets a private link. The secret in it sits after the <code>#</code>, which browsers never send in server logs, and only a hash of it is stored. After voting, the voter gets a receipt code that proves the ballot was accepted, without revealing the choice. Anyone holding it can check it on the <a href="/verify">verify page</a>.</p>

        <h2>Integrity</h2>
        <ul>
          <li>One vote per entitlement is a database constraint with row locking, not an application check.</li>
          <li>Recording that an entitlement voted and storing the ballot happen in one transaction: neither can happen without the other.</li>
          <li>Accepted ballots, receipts and counts cannot be edited or deleted, even by the schema owner.</li>
          <li>Counting refuses to produce a result unless ballots match recorded votes by number and voting units.</li>
          <li>Each organisation's data is isolated by row-level security in PostgreSQL.</li>
        </ul>

        <h2>Known limits of this pilot</h2>
        <div className="notice warn">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>The server encrypts the ballot, so choices exist briefly in server memory.</li>
            <li>In weighted votes, a very large holding can be recognisable from its size during counting.</li>
            <li>A single tally key holder can decrypt. Production should split the key among independent trustees.</li>
            <li>Whoever holds the database administrator password can bypass role separation.</li>
            <li>Administrator accounts do not yet have multi-factor sign-in.</li>
          </ul>
        </div>
        <p>MyVoteMatters is not STQC-certified and should not be used for legally binding shareholder votes until certification and review by Indian corporate counsel are complete.</p>
      </main>
      <SiteFooter />
    </>
  );
}
