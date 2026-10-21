'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="empty">
      <h1>We couldn’t load this page.</h1>
      <p>Your saved records have not been changed. Please try again.</p>
      <button className="button primary fit" onClick={reset}>
        Retry
      </button>
    </main>
  );
}
