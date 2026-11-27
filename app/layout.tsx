import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { ArenaEmailProvider } from '@/components/arena-email-provider';
import { getArenaEmailId } from '@/lib/arena-email';
import './globals.css';
import './aurora.css';
import './styles/ad.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ad Creative Generator',
  description: 'Brief and brand guidelines, then platform and targeting, then a generated ad you can refine.',
};

/**
 * Marks the page as embedded when it runs inside an iframe (Arena). Runs before
 * first paint so the breadcrumb Arena already shows never flashes here.
 */
const EMBEDDED_FLAG_SCRIPT =
  "if (window.self !== window.top) document.documentElement.setAttribute('data-embedded', '');";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const emailId = await getArenaEmailId();
  return (
    // The script below adds an attribute to <html> before hydration.
    <html lang="en" className={jakarta.variable} suppressHydrationWarning>
      <body className={jakarta.className}>
        <script dangerouslySetInnerHTML={{ __html: EMBEDDED_FLAG_SCRIPT }} />
        <div className="aurora-shell-backdrop" aria-hidden="true">
          <span className="beam b1" />
          <span className="beam b2" />
          <span className="beam b3" />
        </div>
        <div className="aurora-shell-noise" aria-hidden="true" />
        <ArenaEmailProvider emailId={emailId}>{children}</ArenaEmailProvider>
      </body>
    </html>
  );
}
