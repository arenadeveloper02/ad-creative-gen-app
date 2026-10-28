import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { ArenaEmailProvider } from '@/components/arena-email-provider';
import { getArenaEmailId } from '@/lib/arena-email';
import './globals.css';

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

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const emailId = await getArenaEmailId();
  return (
    <html lang="en" className={jakarta.variable}>
      <body className={jakarta.className}>
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
