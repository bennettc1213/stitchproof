'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  ClipboardCheck,
  FolderOpen,
  LockKeyhole,
  Package,
  PackageCheck,
  Pause,
  Play,
  Search,
  Settings2,
  Shirt,
  Users,
} from 'lucide-react';
import { ProofArt } from './ui';

const screens = [
  { label: 'Orders', title: 'Your day, in order.', note: 'Know what needs your attention.' },
  {
    label: 'Intake',
    title: 'Every garment accounted for.',
    note: 'Catch the details before production.',
  },
  {
    label: 'Approval',
    title: 'The exact proof. A clear yes.',
    note: 'A customer decision, tied to this version.',
  },
  {
    label: 'Pickup',
    title: 'All finished. All together.',
    note: 'Close the loop with a named collection.',
  },
];
function subscribeMotion(callback: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

export function PortalPreview() {
  const [screen, setScreen] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );
  const playing = !paused && !reduced;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setScreen((current) => (current + 1) % screens.length);
    }, 5500);
    return () => window.clearInterval(timer);
  }, [playing]);
  const choose = (index: number) => {
    setScreen(index);
    setPaused(true);
  };

  return (
    <section className="portal-showcase" aria-label="Interactive StitchProof portal preview">
      <div className="preview-intro">
        <span>
          <i />
          Take a look inside
        </span>
        <span>Fictional demo workspace</span>
      </div>
      <div className="portal-window">
        <div className="portal-browser">
          <span className="browser-dots">
            <i />
            <i />
            <i />
          </span>
          <span>
            <LockKeyhole size={11} />
            StitchProof / Cedar Stitch
          </span>
          <span className="preview-demo-label">DEMO</span>
        </div>
        <div className="portal-shell">
          <aside className="portal-nav" aria-label="Preview screens">
            <span className="portal-mini-logo">
              <span>s</span>StitchProof
            </span>
            <div className="portal-shop">
              <span>CS</span>
              <strong>
                Cedar Stitch<small>Demo workspace</small>
              </strong>
            </div>
            {[FolderOpen, Package, ClipboardCheck, PackageCheck].map((Icon, i) => (
              <button
                type="button"
                key={i}
                aria-label={`Show ${screens[i].label} in portal preview`}
                className={screen === i ? 'selected' : ''}
                aria-current={screen === i ? 'step' : undefined}
                onClick={() => choose(i)}
              >
                <Icon size={15} />
                <span>{screens[i].label}</span>
              </button>
            ))}
            <div className="portal-nav-bottom">
              <Users size={15} />
              <Settings2 size={15} />
              <span>CS</span>
            </div>
          </aside>
          <div className="portal-screen" data-screen={screen}>
            <div className="portal-screen-heading">
              <span>
                {screens[screen].label}
                <ChevronRight size={12} />
                <span>#1048</span>
              </span>
              <span className="preview-owner">AM</span>
            </div>
            <div
              className="portal-stage"
              key={screen}
              role="region"
              aria-label={`${screens[screen].label} preview content`}
              tabIndex={0}
            >
              {screen === 0 ? (
                <>
                  <div className="preview-page-title">
                    <div>
                      <h3>Orders</h3>
                      <p>Let’s keep things moving.</p>
                    </div>
                    <span className="mini-primary">+ New order</span>
                  </div>
                  <div className="preview-metrics">
                    <div>
                      <span>Active orders</span>
                      <strong>6</strong>
                    </div>
                    <div>
                      <span>Needs attention</span>
                      <strong>
                        2<i className="metric-dot amber" />
                      </strong>
                    </div>
                    <div>
                      <span>Ready for pickup</span>
                      <strong>
                        1<i className="metric-dot blue" />
                      </strong>
                    </div>
                  </div>
                  <div className="mini-search">
                    <Search size={13} />
                    Search your orders…
                  </div>
                  <div className="mini-table">
                    <div className="mini-table-head">
                      <span>Order</span>
                      <span>Status</span>
                    </div>
                    {[
                      ['Northline team polos', '24 garments', 'Check intake', 'amber'],
                      ['Fieldwork crew jackets', '12 garments', 'In review', 'purple'],
                      ['Studio Eight totes', '20 garments', 'Ready', 'blue'],
                    ].map(([title, count, status, color], i) => (
                      <div key={title} className={i === 0 ? 'highlight' : ''}>
                        <span className={'mini-garment ' + color}>
                          <Shirt size={18} />
                        </span>
                        <span>
                          <strong>{title}</strong>
                          <small>
                            #{1048 - i} · {count}
                          </small>
                        </span>
                        <span className={'mini-status ' + color}>{status}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : screen === 1 ? (
                <>
                  <div className="preview-page-title">
                    <div>
                      <h3>Northline team polos</h3>
                      <p>Garment intake · #1048</p>
                    </div>
                    <span className="mini-icon">
                      <Package size={20} />
                    </span>
                  </div>
                  <div className="preview-intake-count">
                    <strong>
                      24<span>/24</span>
                    </strong>
                    <span>
                      <Check size={14} />
                      Counts reconciled
                    </span>
                  </div>
                  <div className="preview-size-grid">
                    <span>Size</span>
                    <span>Expected</span>
                    <span>Received</span>
                    {[
                      ['S', 6],
                      ['M', 8],
                      ['L', 6],
                      ['XL', 4],
                    ].map(([size, count]) => (
                      <div key={size}>
                        <strong>{size}</strong>
                        <span>{count}</span>
                        <span>
                          {count}
                          <Check size={12} />
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="preview-update">
                    <Check size={16} />
                    <div>
                      <strong>Missing medium received</strong>
                      <span>Earlier count preserved in order history.</span>
                    </div>
                  </div>
                </>
              ) : screen === 2 ? (
                <>
                  <div className="preview-page-title">
                    <div>
                      <h3>Artwork approval</h3>
                      <p>Northline team polos · Version 02</p>
                    </div>
                    <span className="mini-status purple">Version 2</span>
                  </div>
                  <ProofArt small />
                  <div className="preview-approval">
                    <span className="preview-check">
                      <Check size={19} />
                    </span>
                    <div>
                      <strong>Approved by Alex Morgan</strong>
                      <small>Design, quantities & shop policy confirmed</small>
                    </div>
                    <LockKeyhole size={16} />
                  </div>
                </>
              ) : (
                <>
                  <div className="preview-page-title">
                    <div>
                      <h3>Ready for the handoff.</h3>
                      <p>Northline team polos · #1048</p>
                    </div>
                  </div>
                  <div className="preview-pickup">
                    <span>
                      <PackageCheck size={44} strokeWidth={1.5} />
                    </span>
                    <h4>24 polos. All set.</h4>
                    <p>Completed and counted.</p>
                    <div>
                      <span>
                        Completed<strong>24</strong>
                      </span>
                      <span>
                        Exceptions<strong>0</strong>
                      </span>
                    </div>
                  </div>
                  <div className="preview-collector">
                    <span className="preview-owner">AM</span>
                    <div>
                      <strong>Collected by Alex Morgan</strong>
                      <small>Full order collection recorded</small>
                    </div>
                    <Check size={17} />
                  </div>
                </>
              )}
            </div>
            <div className="portal-bottom">
              <span>
                <i />
                Read-only product preview
              </span>
              <span>Local demo</span>
            </div>
          </div>
        </div>
      </div>
      <div className="preview-controls">
        <div role="group" aria-label="Choose a portal preview screen">
          {screens.map((s, i) => (
            <button
              type="button"
              key={s.label}
              aria-label={`Preview ${s.label}`}
              aria-pressed={screen === i}
              onClick={() => choose(i)}
            >
              <span className={screen === i ? 'active' : ''} />
            </button>
          ))}
          <span>{String(screen + 1).padStart(2, '0')} / 04</span>
        </div>
        <button
          type="button"
          className="preview-play"
          aria-label={playing ? 'Pause portal preview' : 'Play portal preview'}
          onClick={() => setPaused(!paused)}
          disabled={reduced}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          <span>{playing ? 'Pause tour' : 'Play tour'}</span>
        </button>
        <Link href="/demo">
          Open the full demo
          <ArrowRight size={14} />
        </Link>
      </div>
      <div className="preview-caption" aria-live={playing ? 'off' : 'polite'}>
        <strong>{screens[screen].title}</strong>
        <span>{screens[screen].note}</span>
      </div>
    </section>
  );
}
