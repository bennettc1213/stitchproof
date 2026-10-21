import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ClipboardCheck,
  Package,
  Scissors,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Logo } from '@/components/ui';
import { InteractiveHoverLink } from '@/components/ui/interactive-hover-button';
import { HeroHeadline } from '@/components/hero-headline';
import { PortalPreview } from '@/components/portal-preview';
import { brand } from '@/lib/brand';

export default function Home() {
  return (
    <div className="marketing">
      <header className="marketing-nav">
        <Logo />
        <nav aria-label="Main navigation">
          <a href="#workflow">Product</a>
          <Link href="/demo">Live demo</Link>
          <a href="#pricing">Pricing</a>
          <Link href="/guide">Resources</Link>
        </nav>
        <div className="marketing-account">
          <Link href="/login">Log in</Link>
          <Link href="/signup" className="button primary">
            Start your shop
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </header>
      <main id="main-content">
        <section className="hero">
          <div className="hero-copy">
            <span className="launch-pill">
              <span />A clearer workspace for embroidery shops
            </span>
            <HeroHeadline />
            <p>
              Your shop’s work, all together. From the garments at your counter to the proof your
              customer approved—and the moment they pick it up.
            </p>
            <div className="hero-actions">
              <InteractiveHoverLink
                href="/signup"
                text="Start your shop"
                className="h-[51px] w-auto min-w-40 whitespace-nowrap px-6 text-sm max-sm:min-w-0 max-sm:flex-1 max-sm:px-2 border-foreground bg-foreground text-background"
              />
              <InteractiveHoverLink
                href="/demo"
                text="Explore the demo"
                className="h-[51px] w-auto min-w-40 whitespace-nowrap px-6 text-sm max-sm:min-w-0 max-sm:flex-1 max-sm:px-2"
              />
            </div>
            <div className="hero-fine">
              <span>
                <Check size={15} />
                7-day free trial
              </span>
              <span>
                <Check size={15} />
                No card required
              </span>
            </div>
            <div className="hero-workflow-line">
              <span>
                <Package size={17} />
                Intake
              </span>
              <span className="hero-connector" />
              <span>
                <ClipboardCheck size={17} />
                Approval
              </span>
              <span className="hero-connector" />
              <span>
                <Scissors size={17} />
                Pickup
              </span>
            </div>
          </div>
          <PortalPreview />
        </section>
        <section className="product-strip" aria-label="What stays connected">
          <span>
            One place for the work
            <br />
            <strong>behind every stitch.</strong>
          </span>
          <div>
            <Package size={24} />
            <span>Garment intake</span>
          </div>
          <div>
            <ClipboardCheck size={24} />
            <span>Customer approvals</span>
          </div>
          <div>
            <ShieldCheck size={24} />
            <span>Clear order history</span>
          </div>
          <div>
            <Scissors size={24} />
            <span>Production & pickup</span>
          </div>
        </section>
        <section className="workflow-section" id="workflow">
          <div className="section-intro">
            <span className="eyebrow">A WORKFLOW THAT MAKES SENSE</span>
            <h2>
              Less chasing details.
              <br />
              More getting work done.
            </h2>
            <p>Every handoff has a next step. Every important detail has a home.</p>
          </div>
          <div className="workflow-cards">
            {[
              {
                n: '01',
                title: 'Get the intake right.',
                text: 'Record garments by size, flag a missing piece, and document condition before the first stitch.',
                icon: Package,
                detail: 'Expected. Received. Reconciled.',
              },
              {
                n: '02',
                title: 'Make approval clear.',
                text: 'Give customers the exact artwork and instructions to review. Keep every revision and decision connected.',
                icon: ClipboardCheck,
                detail: 'The right proof. The recorded yes.',
              },
              {
                n: '03',
                title: 'Finish with confidence.',
                text: 'Work from the approved details, account for every garment, and record who collected the order.',
                icon: Scissors,
                detail: 'Produced. Counted. Collected.',
              },
            ].map(({ n, title, text, icon: Icon, detail }) => (
              <article className="workflow-card" key={n}>
                <div>
                  <span className="feature-icon">
                    <Icon size={25} />
                  </span>
                  <span>{n}</span>
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
                <footer>
                  <Check size={16} />
                  {detail}
                </footer>
              </article>
            ))}
          </div>
          <Link className="text-link section-demo-link" href="/demo/story">
            Follow one order from start to finish
            <ArrowRight size={18} />
          </Link>
        </section>
        <section className="pricing-section" id="pricing">
          <div className="section-intro">
            <span className="eyebrow">STRAIGHTFORWARD BY DESIGN</span>
            <h2>
              Small shop.
              <br />
              One simple plan.
            </h2>
            <p>The whole order workflow, without the whole-business migration.</p>
          </div>
          <div className="pricing-grid">
            <div className="pricing-explainer">
              <span className="pricing-icon">
                <Sparkles size={30} />
              </span>
              <h3>
                A home for your
                <br />
                shop’s daily work.
              </h3>
              <p>
                Keep the invoicing and accounting tools you already use. StitchProof connects the
                garment details, the customer’s decision, and the final handoff.
              </p>
              <div className="pricing-inclusions">
                <div>
                  <UsersIcon />
                  <span>
                    <strong>A small team, in sync</strong>One owner and two staff members.
                  </span>
                </div>
                <div>
                  <ShieldCheck size={22} />
                  <span>
                    <strong>Your shop’s records</strong>Private files and exportable order data.
                  </span>
                </div>
              </div>
              <Link href="/demo" className="text-link">
                See what’s inside
                <ArrowUpRight size={17} />
              </Link>
            </div>
            <div className="price-card">
              <div className="price-card-heading">
                <span>THE SHOP PLAN</span>
                <span className="price-badge">Everything, in one place</span>
              </div>
              <div className="price">
                ${brand.price}
                <span>USD / month</span>
              </div>
              <p>Try it for seven days. No card required.</p>
              <InteractiveHoverLink
                href="/signup"
                text="Start your seven-day trial"
                className="mb-[27px] flex h-[51px] w-full text-sm border-foreground bg-foreground text-background"
              />
              <div className="price-list-label">YOUR SHOP PLAN INCLUDES</div>
              <ul>
                {[
                  'Garment intake & condition photos',
                  'Versioned proofs & customer approvals',
                  'Production tracking & recorded pickup',
                  'Three team members total',
                  '2 GiB of private file storage',
                  'Order PDFs, QR sheets & data exports',
                ].map((x) => (
                  <li key={x}>
                    <span>
                      <Check size={14} />
                    </span>
                    {x}
                  </li>
                ))}
              </ul>
              <small>
                Paid checkout starts your subscription immediately. Unused app trial time does not
                delay the charge.
              </small>
            </div>
          </div>
        </section>
        <section className="faq-section">
          <div>
            <span className="eyebrow">A FEW MORE DETAILS</span>
            <h2>
              Good questions.
              <br />
              Clear answers.
            </h2>
          </div>
          <div>
            {[
              {
                q: 'Do I need to change my invoicing software?',
                a: 'No. StitchProof focuses on customer-supplied garment intake, proof decisions, and pickup. Keep using your existing invoicing and accounting tools.',
              },
              {
                q: 'Does my customer need an account?',
                a: 'No. A customer reviews one proof through a secure bearer link. They can request changes or record an approval against the exact version shown.',
              },
              {
                q: 'Can I try the product before signing up?',
                a: 'Yes. The read-only demo uses a fictional shop and orders. Explore the portal, open an order, and walk through the complete process without creating an account.',
              },
              {
                q: 'What happens when my trial ends?',
                a: 'The planned subscription is $39 USD per month. Existing records remain readable and exportable when shop access expires. New work requires an active trial or paid access. Billing is still being connected in this development build.',
              },
            ].map(({ q, a }) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="closing-cta">
          <span className="eyebrow">YOUR NEXT ORDER, A LITTLE MORE ORGANIZED</span>
          <h2>
            Good work deserves
            <br />a clear thread.
          </h2>
          <p>Take a look around. See how every detail stays connected.</p>
          <InteractiveHoverLink
            href="/demo"
            text="Explore StitchProof"
            className="h-[51px] w-auto min-w-48 px-7 text-sm border-foreground bg-foreground text-background"
          />
        </section>
      </main>
      <footer className="marketing-footer">
        <div>
          <Logo />
          <p>The workspace behind the stitch.</p>
        </div>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/guide">Quick start</Link>
        </div>
        <span>Built for independent shops.</span>
      </footer>
    </div>
  );
}
function UsersIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 5a5 5 0 0 1 3 4v2" />
    </svg>
  );
}
