import Link from 'next/link';
import {
  ArrowUpRight,
  Check,
  Circle,
  Clock3,
  PackageCheck,
  Scissors,
  TriangleAlert,
} from 'lucide-react';
import { labels } from '@/lib/domain';
import { brand } from '@/lib/brand';
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="logo" aria-label={`${brand.name} home`}>
      <span className="logo-mark">
        <svg width="24" height="28" viewBox="0 0 24 28" fill="none" aria-hidden="true">
          <path
            d="M7 4h10M12 4v18M5 12c0-4 14-4 14 0s-14 4-14 8 14 4 14 0"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path d="m10 25 2-3 2 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      {!compact && (
        <span>
          {brand.name}
          <span className="logo-dot">.</span>
        </span>
      )}
    </Link>
  );
}
export function Status({ value }: { value: string }) {
  const Icon =
    value === 'approved' || value === 'completed'
      ? Check
      : value === 'changes_requested' || value === 'invalidated'
        ? TriangleAlert
        : value === 'in_production'
          ? Scissors
          : value === 'ready_for_pickup'
            ? PackageCheck
            : value === 'pending'
              ? Clock3
              : Circle;
  return (
    <span className={`status status-${value}`}>
      <Icon size={12} />
      {labels[value] || value}
    </span>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {name
        .split(' ')
        .map((x) => x[0])
        .slice(0, 2)
        .join('')}
    </span>
  );
}
export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Scissors size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Section({
  title,
  kicker,
  children,
  action,
}: {
  title: string;
  kicker?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          {kicker && <span className="eyebrow">{kicker}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-link">
      {children}
      <ArrowUpRight size={14} />
    </Link>
  );
}
export function ProofArt({ small = false, version = 2 }: { small?: boolean; version?: number }) {
  return (
    <div className={`proof-art ${small ? 'proof-small' : ''}`}>
      <div className="proof-art-label">
        <span>CEDAR STITCH / ARTWORK PROOF</span>
        <span>V{version.toString().padStart(2, '0')}</span>
      </div>
      <svg
        viewBox="0 0 600 410"
        role="img"
        aria-label={`Fictional sand polo with forest green Northline left chest embroidery, proof version ${version}`}
      >
        <defs>
          <pattern id="fabric" patternUnits="userSpaceOnUse" width="5" height="5">
            <path d="M0 0h5v5" stroke="#b6a98c" strokeWidth=".3" fill="none" opacity=".2" />
          </pattern>
        </defs>
        <ellipse cx="300" cy="375" rx="148" ry="13" fill="#24372b" opacity=".07" />
        <path
          d="m219 68 45-17h72l45 17 74 71-47 58-38-28 14 193H216l14-193-38 28-47-58z"
          fill="#ddd0b3"
          stroke="#b9ac8d"
          strokeWidth="2"
        />
        <path
          d="m219 68 45-17h72l45 17 74 71-47 58-38-28 14 193H216l14-193-38 28-47-58z"
          fill="url(#fabric)"
        />
        <path
          d="m264 51 36 37 36-37 19 28-38 40-17-31-17 31-38-40z"
          fill="#c9bb9c"
          stroke="#b5a584"
          strokeWidth="1.5"
        />
        <path d="M300 88v85h13v-68" fill="#d1c2a2" stroke="#b5a584" strokeWidth="1" />
        <circle cx="307" cy="125" r="2" fill="#a79877" />
        <circle cx="307" cy="150" r="2" fill="#a79877" />
        <path
          d="m230 169 6-58m134 58-6-58M217 346h166M153 143l45 43m204 0 45-43"
          stroke="#b5a584"
          strokeWidth="1.4"
          fill="none"
        />
        <g transform={`translate(345 158) scale(${version === 1 ? 1.25 : 1})`}>
          <path d="m-12-12 6-9 6 9 6-9 6 9" stroke="#254e3b" strokeWidth="1.7" fill="none" />
          <text
            textAnchor="middle"
            y="3"
            fontFamily="Arial,sans-serif"
            fontWeight="700"
            fontSize="8"
            letterSpacing="1.6"
            fill="#254e3b"
          >
            NORTHLINE
          </text>
        </g>
        <path d="M385 161h64m-3-3 3 3-3 3" stroke="#75816c" strokeWidth="1" strokeDasharray="3 3" />
        <text x="451" y="164" fontFamily="Arial,sans-serif" fontSize="9" fill="#6a7365">
          LEFT CHEST
        </text>
      </svg>
      <div className="proof-art-footer">
        <span>Northline / Company polos</span>
        <span>{version === 1 ? '3.75' : '3.0'}″ wide · Forest green</span>
      </div>
    </div>
  );
}
