import type { Metadata } from 'next';
import './globals.css';
import { brand } from '@/lib/brand';
export const metadata: Metadata = {
  icons: { icon: '/icon.svg' },
  title: {
    default: `${brand.name} — Every detail, in order`,
    template: `%s · ${brand.name}`,
  },
  description:
    'Garment intake, proof approval, and pickup tracking for independent embroidery shops.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
