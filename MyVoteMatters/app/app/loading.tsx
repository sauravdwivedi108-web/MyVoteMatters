// Shown at once while the next workspace page is fetched from the server.
export default function Loading() {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      <span className="sk-title" />
      <span className="sk-card" />
      <span className="sk-card" />
    </div>
  );
}
