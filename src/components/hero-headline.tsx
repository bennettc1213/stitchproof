'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

// "Every ___." walks through what embroidery shops actually decorate, then settles back on the
// brand line so the headline rests as "Every garment. The right proof. One clear order."
const garments = ['garment', 'polo', 'cap', 'jacket', 'tote', 'hoodie', 'apron'];
const HOLD_MS = 2300;

function subscribeMotion(callback: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

export function HeroHeadline() {
  // step 0 is the resting "garment"; step garments.length wraps back to it and stops the tour.
  const [step, setStep] = useState(0);
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => true,
  );
  const playing = !reduced && step < garments.length;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setStep((current) => current + 1);
    }, HOLD_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  const current = step % garments.length;
  const previous = step > 0 ? (step - 1) % garments.length : -1;

  return (
    <h1>
      <span className="sr-only">Every garment. The right proof. One clear order.</span>
      <span aria-hidden="true">
        <span className="hero-line">
          Every{' '}
          <span className="hero-rotator">
            {garments.map((word, i) => (
              <span
                key={word}
                className="hero-rotator-word"
                data-state={i === current ? 'active' : i === previous ? 'leaving' : 'waiting'}
              >
                {word}.
              </span>
            ))}
          </span>
        </span>
        <span className="hero-line">The right proof.</span>
        <em className="hero-line">One clear order.</em>
      </span>
    </h1>
  );
}
