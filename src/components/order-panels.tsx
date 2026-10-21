'use client';
import { Children, useId, useState, type ReactNode } from 'react';
import { ClipboardCheck, Package, Scissors, SlidersHorizontal } from 'lucide-react';
const panels = [
  { label: 'Garment intake', icon: Package },
  { label: 'Instructions', icon: SlidersHorizontal },
  { label: 'Proofs & approval', icon: ClipboardCheck },
  { label: 'Production & pickup', icon: Scissors },
];
export function OrderPanels({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(0);
  const id = useId();
  const sections = Children.toArray(children);
  return (
    <div className="detail-primary">
      <div className="order-panel-tabs" role="tablist" aria-label="Order workspace">
        {panels.map(({ label, icon: Icon }, i) => (
          <button
            type="button"
            key={label}
            id={`${id}-tab-${i}`}
            role="tab"
            aria-controls={`${id}-panel-${i}`}
            aria-selected={active === i}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(event) => {
              if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? 3
                      : (i + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
                setActive(next);
                document.getElementById(`${id}-tab-${next}`)?.focus();
              }
            }}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </div>
      {sections.map((section, i) => (
        <div
          key={i}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={active !== i}
        >
          {section}
        </div>
      ))}
    </div>
  );
}
