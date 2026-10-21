'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  CircleHelp,
  ExternalLink,
  FolderOpen,
  PanelLeftClose,
  Settings2,
  Users,
  ArrowUpRight,
  Menu,
  X,
} from 'lucide-react';
import { Logo, Avatar } from './ui';
import { useState } from 'react';
import { ActionForm } from './forms';
export function Shell({
  children,
  demo = false,
  shopName,
  role = 'owner',
  readOnly = false,
  logo = null,
}: {
  children: React.ReactNode;
  demo?: boolean;
  shopName: string;
  role?: string;
  readOnly?: boolean;
  logo?: { url: string } | null;
}) {
  const pathname = usePathname();
  const base = demo ? '/demo' : '/app';
  const [open, setOpen] = useState(false);
  const nav = [
    { label: 'Orders', href: base + (demo ? '' : '/orders'), icon: FolderOpen },
    { label: 'Customers', href: base + '/customers', icon: Users },
    { label: 'Shop settings', href: base + '/settings/shop', icon: Settings2 },
  ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'mobile-open' : ''}`}>
        <div className="sidebar-brand">
          <Logo />
          <button
            className="icon-button mobile-close"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
          <PanelLeftClose size={17} className="sidebar-collapse" />
        </div>
        <div className="shop-switch">
          {logo ? (
            <span className="shop-monogram shop-logo-mark">
              {/* Native image supports the authorization-checked same-origin logo route. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo.url} alt={`${shopName} logo`} />
            </span>
          ) : (
            <span className="shop-monogram" aria-hidden="true">
              {demo ? 'CS' : initials(shopName)}
            </span>
          )}
          <div>
            <strong>{shopName}</strong>
            <small>{demo ? 'Fictional workspace' : 'Your workspace'}</small>
          </div>
          <ChevronsUpDown size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {nav.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`nav-item ${(label === 'Orders' ? pathname === base || pathname.startsWith(base + '/orders') : pathname.startsWith(href.replace('/shop', ''))) ? 'active' : ''}`}
            >
              <Icon size={18} />
              {label}
              {label === 'Orders' && <span className="nav-indicator" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="tiny-stitch">✳</span>
            <strong>{demo ? 'A calmer kind of workflow.' : 'Everything in its place.'}</strong>
            <p>
              {demo
                ? 'Take a look around. Every order here is fictional.'
                : 'Intake to pickup, with the details connected.'}
            </p>
            <Link href={demo ? '/demo/story' : '/app/settings/billing'}>
              {demo ? 'Walk through an order' : 'View your plan'}
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <Link className="nav-item" href="/guide">
            <CircleHelp size={17} />
            Quick start guide
            <ExternalLink size={13} />
          </Link>
          <Link className="nav-item" href="/">
            <BookOpen size={17} />
            About StitchProof
          </Link>
          <div className="sidebar-user">
            <Avatar name={demo ? 'Cedar Stitch' : shopName} />
            <div>
              <strong>
                {demo ? 'Demo explorer' : role === 'owner' ? 'Shop owner' : 'Team member'}
              </strong>
              <small>{demo ? 'Read-only access' : role}</small>
            </div>
            {demo ? (
              <ChevronDown size={14} />
            ) : (
              <ActionForm intent="logout" label="Sign out" className="logout-form">
                <input type="hidden" name="email" value="unused@example.test" />
              </ActionForm>
            )}
          </div>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">
              Workspace <span>/</span>{' '}
              <strong>
                {pathname.includes('customers')
                  ? 'Customers'
                  : pathname.includes('settings')
                    ? 'Settings'
                    : pathname.includes('story')
                      ? 'Product walkthrough'
                      : 'Orders'}
              </strong>
            </span>
          </div>
          <div className="topbar-right">
            <span className="live-label">
              <i />
              {demo ? 'READ-ONLY DEMO' : 'SHOP WORKSPACE'}
            </span>
            <Link href={demo ? '/signup' : '/app/settings/shop'} className="topbar-link">
              {demo ? 'Start your own shop' : 'Shop settings'}
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <span className="demo-tag">DEMO</span> Fictional shop and orders. Explore freely;
              records are read-only.
            </span>
            <Link href="/demo/story">
              See the full workflow <ArrowUpRight size={13} />
            </Link>
          </div>
        )}
        <main id="main-content" className="workspace-main">
          {!demo && readOnly && (
            <div className="notice warning">
              <span>
                Your shop is read-only. Existing records and exports remain available, and
                already-sent review links work until they expire.{' '}
                {role === 'owner' ? (
                  <Link href="/app/settings/billing">Manage billing to resume new work.</Link>
                ) : (
                  'Ask your shop owner to restore access.'
                )}
              </span>
            </div>
          )}
          {children}
        </main>
        <footer className="workspace-footer">
          <span>Made for the details that matter.</span>
          <span>
            Intake. Approval. Pickup.<span className="footer-stitch"> ┄┄✳</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '✳'
  );
}
