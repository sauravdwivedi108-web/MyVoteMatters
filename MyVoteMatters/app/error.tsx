'use client';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="section doc narrow">
      <p className="kicker">Error</p>
      <h1>Something went wrong</h1>
      <p className="muted">This page could not be loaded. Nothing about a vote was changed.</p>
      <button className="btn" type="button" onClick={() => reset()}>Try again</button>
    </main>
  );
}
