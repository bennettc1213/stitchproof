import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Logo } from '@/components/ui';
export function generateStaticParams() {
  return [{ page: 'privacy' }, { page: 'terms' }, { page: 'guide' }];
}
export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!['privacy', 'terms', 'guide'].includes(page)) notFound();
  return (
    <main id="main-content" className="document-page">
      <Logo />
      <span className="eyebrow">
        {page === 'guide' ? 'GETTING STARTED' : 'EDITABLE DRAFT · FOUNDER REVIEW REQUIRED'}
      </span>
      <h1>
        {page === 'privacy'
          ? 'Privacy notice'
          : page === 'terms'
            ? 'Terms of use'
            : 'A calmer order, in five minutes.'}
      </h1>
      {page === 'guide' ? (
        <>
          <p>
            StitchProof keeps customer-supplied garment intake, proof decisions, and pickup history
            together.
          </p>
          <ol>
            <li>
              Create a shop account, verify your email, and add your shop’s name, timezone, and
              existing policy.
            </li>
            <li>
              Create a customer order. Record expected and received counts by size, condition
              photos, and decoration instructions.
            </li>
            <li>
              Resolve discrepancies with a recorded reason. Upload proof files and create a customer
              review link.
            </li>
            <li>
              The customer reviews the exact version and either requests changes or approves with
              two separate acknowledgments.
            </li>
            <li>
              Start production against the current approval, count completed garments and
              exceptions, then record the named collector.
            </li>
          </ol>
          <p>
            The read-only tour is available now. Real workspace access requires Supabase
            configuration on this development machine.
          </p>
          <Link className="button primary fit" href="/demo/story">
            Walk through a fictional order →
          </Link>
        </>
      ) : (
        <>
          <div className="notice warning">
            This draft is not ready for production publication. Operator identity, contact details,
            retention periods, and final legal review are still required.
          </div>
          {page === 'privacy' ? (
            <>
              <h2>Information used for the workflow</h2>
              <p>
                The application stores shop accounts, memberships, customer contact details, garment
                records, uploaded files, proof snapshots, typed approval names, decisions, and order
                history. Customer-facing review pages are limited to their linked proof bundle.
              </p>
              <h2>Access and storage</h2>
              <p>
                Supabase provides authentication, database storage, and private file storage when
                configured. Review links are bearer links: anyone possessing an active link can view
                that proof. Avoid sharing them beyond the intended customer.
              </p>
              <h2>Export and deletion</h2>
              <p>
                Owners can export structured workspace records and obtain an attachment manifest.
                Cancellation of a subscription does not delete shop data. Closure requires a
                verified owner and the manual procedure in the operating documentation.
              </p>
              <h2>Before launch</h2>
              <p>
                The founder must identify the service operator and privacy contact, choose retention
                and infrastructure logging policies, configure production providers, and review
                applicable requirements. No production data retention guarantees are made by this
                draft.
              </p>
            </>
          ) : (
            <>
              <h2>Service and limits</h2>
              <p>
                The proposed plan is $39 USD per month for one shop, one owner and two staff, with 2
                GiB of file storage. A seven-day app-managed trial begins at workspace creation.
                Completing paid checkout starts the subscription immediately.
              </p>
              <h2>Shop responsibilities</h2>
              <p>
                Shops supply accurate garment records, review production suitability, obtain
                permission to use artwork, and provide their own garment policy. StitchProof does
                not create embroidery machine files or process customer payments to the shop.
              </p>
              <h2>Approval records</h2>
              <p>
                Proof decisions record a typed name and acknowledgment against a version. A bearer
                link does not verify identity, certify a digital signature, or guarantee legal
                enforceability. The record does not eliminate production risk or shop liability.
              </p>
              <h2>Production launch</h2>
              <p>
                Operator identity, support contact, cancellation details, dispute terms, and
                applicable legal review must be supplied before accepting real subscriptions.
              </p>
            </>
          )}
        </>
      )}
      <footer>
        <Link href="/">← Back to StitchProof</Link>
      </footer>
    </main>
  );
}
