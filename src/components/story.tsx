'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, PackageCheck } from 'lucide-react';
import { ProofArt, Status } from './ui';
const scenes = [
  {
    title: 'Start with what actually arrived.',
    description:
      'Alex expects to deliver 24 company polos. The shop receives 23: one medium is missing. Intake records the discrepancy before a proof can be sent.',
    action: '23 of 24 garments received',
    status: 'not_requested',
  },
  {
    title: 'Resolve it. Keep the history.',
    description:
      'The missing medium arrives. A staff member records the received count as 8 with the reason “Customer delivered the missing medium polo.” The previous count of 7 stays in history.',
    action: '24 of 24 garments · Counts reconcile',
    status: 'not_requested',
  },
  {
    title: 'Send the exact first proof.',
    description:
      'Version 1 captures the artwork files, quantities, placement, exact text, and the shop policy. The review link grants access only to this bundle.',
    action: 'Version 1 · Review link created',
    status: 'pending',
  },
  {
    title: 'Make room for a useful revision.',
    description:
      'Alex requests a smaller logo. The comment belongs to version 1. It cannot be edited into an approval by a staff member.',
    action: '“Could we make the logo a little smaller?”',
    status: 'changes_requested',
  },
  {
    title: 'A new version. A clear decision.',
    description:
      'The shop sends version 2 with the smaller logo. Alex reviews the new snapshot, enters a name, and acknowledges the design, quantities, and policy. Version 1 remains changes requested.',
    action: 'Version 2 · Approved by Alex Morgan',
    status: 'approved',
  },
  {
    title: 'Produce what was approved.',
    description:
      'Only the current approved snapshot can start production. Its specifications are now locked. Internal notes remain separate from the customer-facing record.',
    action: 'Production started against version 2',
    status: 'in_production',
  },
  {
    title: 'Count it out. Close the loop.',
    description:
      'The shop records 24 completed polos and zero exceptions. It marks the order ready, then records Alex Morgan as the named collector. Every step remains with the order.',
    action: '24 completed · Collected by Alex Morgan',
    status: 'completed',
  },
];
export function Story() {
  const [index, setIndex] = useState(0);
  const scene = scenes[index];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE FIVE-MINUTE PRODUCT TOUR</span>
          <h1>Follow the thread.</h1>
          <p>One fictional order. From a missing polo to a confident handoff.</p>
        </div>
        <Link className="button secondary" href="/demo">
          Back to orders
        </Link>
      </div>
      <div className="story-layout">
        <nav className="story-steps" aria-label="Walkthrough steps">
          {scenes.map((s, i) => (
            <button
              key={s.title}
              className={i === index ? 'selected' : ''}
              onClick={() => setIndex(i)}
            >
              <span>{i < index ? <Check size={14} /> : String(i + 1).padStart(2, '0')}</span>
              <strong>
                {
                  [
                    'Receive 23 of 24',
                    'Reconcile the count',
                    'Send version 1',
                    'Request a change',
                    'Approve version 2',
                    'Start production',
                    'Record the pickup',
                  ][i]
                }
              </strong>
            </button>
          ))}
        </nav>
        <section className="story-panel">
          <div className="story-visual">
            {index < 2 ? (
              <div className="story-count">
                <span className="eyebrow">NORTHLINE TEAM POLOS</span>
                <strong>
                  {index === 0 ? '23' : '24'}
                  <span>/24</span>
                </strong>
                <p>garments received</p>
                <div className="polo-dots">
                  {Array.from({ length: 24 }, (_, i) => (
                    <span key={i} className={index === 0 && i === 23 ? 'missing' : ''} />
                  ))}
                </div>
                <div className={`notice ${index === 0 ? 'warning' : 'success'}`}>
                  {index === 0
                    ? '1 medium polo missing'
                    : 'Missing medium received. History preserved.'}
                </div>
              </div>
            ) : index < 5 ? (
              <ProofArt version={index < 4 ? 1 : 2} />
            ) : (
              <div className="story-complete">
                {index === 5 ? (
                  <LockKeyhole size={58} strokeWidth={1} />
                ) : (
                  <PackageCheck size={64} strokeWidth={1} />
                )}
                <h3>{index === 5 ? 'Approved details. Locked in.' : 'All 24. All set.'}</h3>
                <span>Northline team polos · #1048</span>
                <Status value={scene.status} />
              </div>
            )}
          </div>
          <div className="story-content">
            <span className="eyebrow">
              STEP {index + 1} OF {scenes.length}
            </span>
            <h2>{scene.title}</h2>
            <p>{scene.description}</p>
            <div className="story-action">
              <Status value={scene.status} />
              <strong>{scene.action}</strong>
            </div>
            <div className="story-controls">
              <button
                className="button secondary"
                disabled={index === 0}
                onClick={() => setIndex(index - 1)}
              >
                <ArrowLeft size={15} />
                Previous
              </button>
              {index < scenes.length - 1 ? (
                <button className="button primary" onClick={() => setIndex(index + 1)}>
                  Next step
                  <ArrowRight size={15} />
                </button>
              ) : (
                <Link className="button primary" href="/demo/review">
                  Explore customer view
                  <ArrowRight size={15} />
                </Link>
              )}
            </div>
            <p className="fine-print">
              Read-only tour of fictional records. These scenes illustrate the workflow and do not
              create or modify orders.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
