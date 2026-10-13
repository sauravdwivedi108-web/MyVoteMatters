# MyVoteMatters

Secure corporate e-voting for AGM resolutions, board elections and member votes. A Next.js website, admin console and mobile-friendly voter app on top of a PostgreSQL voting core that enforces eligibility, one vote per entitlement, ballot secrecy and reconciled counting in the database itself.

## Deploy on Vercel

1. Import this repository at **vercel.com/new**. No build settings need changing.
2. In the new project open **Storage → Create → Neon (Postgres)** and connect it to the project. Vercel sets `DATABASE_URL`.
3. Redeploy. Tables are created automatically on first use.
4. Open the site, choose **Start free**, and create your workspace.

## What's in it

| Area | Route | Who |
| --- | --- | --- |
| Website | `/`, `/security` | Public |
| Sign up / sign in | `/signup`, `/login` | Administrators |
| Dashboard, elections, team | `/app`, `/app/elections/…`, `/app/team` | Owner, election admin, approver, scrutinizer, viewer |
| Voter app | `/vote#<private link>` | Voters, any phone or computer; installable to the home screen |
| Receipt check | `/verify` | Voters |
| Published results | `/results/<org>/<election>` | Public, after publication |

### Running an election

1. **Create** an election: AGM resolutions, board election or internal poll, with voting window (IST) and record date.
2. **Import the voter roll**: paste `reference, voting units` rows straight from Excel. Bad rows are reported, never guessed.
3. **Build the ballot**: ordinary or special resolutions, or a single-choice question.
4. **Submit**, then a **second person approves**. Approval locks everything and hands over the **tally key** once. Download it and keep it with your scrutinizer: MyVoteMatters never stores it and the votes cannot be counted without it.
5. **Create voting links** and send each voter theirs (download as CSV). Links are shown once; only hashes are stored.
6. **Open voting**. Voters choose, review, confirm and get a receipt code. Turnout is live; results stay sealed.
7. **Close voting**, **count** with the tally key file, check the reconciliation, then **publish**.

## Guarantees and their limits

See `/security` in the app, and the comments in `db/001_core.sql`. In short: role-separated database access keeps "who voted" apart from "what they voted"; one-vote-per-entitlement, immutability, the election state machine, maker-checker approval and tenant isolation are enforced by PostgreSQL; counts refuse to run unless ballots reconcile with votes recorded.

Known limits of this pilot: the server encrypts ballots so it briefly sees choices; large weighted holdings may be recognisable during counting; one tally key holder can decrypt; anyone with the database password can bypass role separation; administrator MFA, email delivery of links and shared rate limiting are not built yet. It is not STQC-certified and should not be used for legally binding shareholder votes until certified and reviewed by counsel.

## Develop

```
npm install
cp .env.example .env.local   # point DATABASE_URL at any Postgres 16+
npm run dev
npm test                     # voting-core tests against a throwaway local Postgres
```
