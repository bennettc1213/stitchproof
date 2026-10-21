import { reviewAccess } from '@/lib/review-access';
import { ReviewPage } from '@/components/review';
import { Logo } from '@/components/ui';
import { logoInfo } from '@/lib/shop-logo';
export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Customer proof review',
  robots: { index: false, follow: false },
};
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let review = null,
    logo = null;
  if (/^[a-f0-9]{64}$/.test(token)) {
    try {
      const { service, digest } = await reviewAccess(token);
      const [bundle, shopLogo] = await Promise.all([
        service.rpc('review_bundle', { p_digest: digest }),
        service.rpc('review_logo', { p_digest: digest }),
      ]);
      review = bundle.data;
      if (shopLogo.data)
        logo = logoInfo(
          {
            logo_path: shopLogo.data.path,
            logo_digest: shopLogo.data.digest,
            logo_width: shopLogo.data.width,
            logo_height: shopLogo.data.height,
          },
          token,
        );
    } catch {}
  }
  if (!review)
    return (
      <main id="main-content" className="inactive-review">
        <Logo />
        <div className="empty">
          <h1>This review link is inactive.</h1>
          <p>It may have expired or been replaced. Contact your shop for a current link.</p>
        </div>
      </main>
    );
  return <ReviewPage review={review} token={token} logo={logo} />;
}
