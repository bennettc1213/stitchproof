import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main-content" className="empty">
      <h1>That page isn’t here.</h1>
      <p>Check the address or return to the order list.</p>
      <Link className="button primary fit" href="/demo">
        Explore the demo
      </Link>
    </main>
  );
}
