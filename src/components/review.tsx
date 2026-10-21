import Link from 'next/link';
import { Check, FileImage, LockKeyhole } from 'lucide-react';
import type { Proof } from '@/lib/domain';
import { totals, dateOnly } from '@/lib/domain';
import { Logo, ProofArt, Status } from './ui';
import { ReviewDecision } from './forms';
type Review = Proof & {
  snapshot: Proof['snapshot'] & {
    shop?: string;
    title?: string;
    order_number?: number;
    due_date?: string;
  };
};
export function ReviewPage({
  review: r,
  token,
  demo = false,
  logo = null,
}: {
  review: Review;
  token?: string;
  demo?: boolean;
  logo?: { url: string; width: number; height: number } | null;
}) {
  const t = totals(r.snapshot.garments);
  return (
    <div className="review-page">
      <header>
        <Logo />
        <span>
          <LockKeyhole size={13} />
          CUSTOMER PROOF REVIEW
        </span>
      </header>
      <main id="main-content" className="review-main">
        {demo && (
          <div className="notice warning">
            Demo — fictional shop and order. Decisions are disabled in this public tour.
          </div>
        )}
        <div className="review-intro">
          {logo && (
            // Native image supports the token-bound same-origin logo route.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="review-shop-logo"
              src={logo.url}
              alt={`${r.snapshot.shop || 'Shop'} logo`}
              width={logo.width}
              height={logo.height}
            />
          )}
          <span className="eyebrow">
            {r.snapshot.shop || 'Cedar Stitch Demo'} · ORDER #{r.snapshot.order_number || 1048}
          </span>
          <h1>Let’s get the details right.</h1>
          <p>
            {r.snapshot.title || 'Northline team polos'} · Proof version {r.version}
          </p>
        </div>
        <div className="review-layout">
          <div>
            <section className="panel review-proof">
              <div className="panel-heading">
                <h2>Your artwork</h2>
                <span className="tag">VERSION {r.version.toString().padStart(2, '0')}</span>
              </div>
              {demo ? (
                <ProofArt version={r.version} />
              ) : (
                r.files.map((f) => (
                  <div className="review-file" key={f.id}>
                    {f.mime.startsWith('image/') ? (
                      <div className="review-image-wrap">
                        {/* Native image supports protected, token-bound same-origin downloads. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${f.id}?token=${token}`} alt={f.name} />
                      </div>
                    ) : (
                      <Link
                        target="_blank"
                        href={`/api/files/${f.id}?token=${token}`}
                        className="button secondary"
                      >
                        <FileImage size={17} />
                        Open proof PDF: {f.name}
                      </Link>
                    )}
                    <p>{f.name}</p>
                  </div>
                ))
              )}
            </section>
            <section className="panel">
              <h2>The details you’re approving</h2>
              <dl className="spec-grid">
                {Object.entries({
                  Placement: r.snapshot.spec.placement,
                  Dimensions: r.snapshot.spec.dimensions,
                  'Thread / colors': r.snapshot.spec.thread,
                  'Exact embroidered text': r.snapshot.spec.text,
                  Instructions: r.snapshot.spec.instructions,
                }).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v || 'None specified'}</dd>
                  </div>
                ))}
              </dl>
              <div className="mini-divider" />
              <h3>Garments · {t.received} received</h3>
              {r.snapshot.garments.map((g, i) => (
                <div key={i} className="review-garments">
                  <strong>{g.description}</strong>
                  <p>
                    {g.color} · {g.sizes.map((s) => `${s.received} × ${s.size}`).join(' / ')}
                  </p>
                </div>
              ))}
              {r.snapshot.due_date && <p className="muted">Due {dateOnly(r.snapshot.due_date)}</p>}
            </section>
            <section className="panel">
              <span className="eyebrow">POLICY VERSION {r.snapshot.policy_version}</span>
              <h2>The shop’s policy</h2>
              <p className="policy-text">
                {r.snapshot.policy || 'The shop has not supplied additional policy text.'}
              </p>
            </section>
          </div>
          <aside>
            <section className="panel decision-panel">
              {r.choice ? (
                <>
                  <span className="summary-icon green">
                    <Check size={22} />
                  </span>
                  <h2>
                    {r.choice === 'approved'
                      ? 'Your approval is recorded.'
                      : 'Your changes are with the shop.'}
                  </h2>
                  <Status value={r.choice} />
                  <p>
                    {r.choice === 'approved'
                      ? `Version ${r.version} was approved by ${r.name}.`
                      : 'The shop can prepare a new version for your review.'}
                  </p>
                  {r.comments && <blockquote>{r.comments}</blockquote>}
                  <p className="fine-print">
                    This recorded decision cannot be changed through this link.
                  </p>
                </>
              ) : (
                <>
                  <span className="eyebrow">TAKE A MOMENT TO CHECK</span>
                  <h2>Ready for the next stitch?</h2>
                  <p>
                    Review every proof page, the quantities, exact text, and shop policy before you
                    decide.
                  </p>
                  {demo ? (
                    <>
                      <ul className="review-checklist">
                        <li>Design, placement & spelling</li>
                        <li>Garment descriptions & quantities</li>
                        <li>The shop policy shown below</li>
                      </ul>
                      <div className="notice">
                        A real review asks for your name and two separate confirmations. Need a
                        change? Send a written request instead.
                      </div>
                      <Link className="button secondary" href="/demo/story">
                        Back to the walkthrough →
                      </Link>
                    </>
                  ) : (
                    <ReviewDecision token={token!} />
                  )}
                </>
              )}
            </section>
            <p className="review-help">
              Questions about this order? Contact your shop before approving.
            </p>
          </aside>
        </div>
      </main>
      <footer>
        <Logo />
        <span>A clearer thread from intake to pickup.</span>
      </footer>
    </div>
  );
}
