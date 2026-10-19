import type { Metadata, Viewport } from 'next';
import { Cinzel, IBM_Plex_Mono, Playfair_Display, Source_Sans_3 } from 'next/font/google';
import './globals.css';

const sans = Source_Sans_3({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Playfair_Display({ subsets: ['latin'], variable: '--font-serif', display: 'swap' });
const brand = Cinzel({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-brand', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'MyVoteMatters · Secure corporate e-voting', template: '%s · MyVoteMatters' },
  description: 'Run AGM resolutions, board elections and member votes with verified eligibility, secret ballots and reconciled results.',
  applicationName: 'MyVoteMatters',
  appleWebApp: { capable: true, title: 'MyVoteMatters', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#07111f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${sans.variable} ${serif.variable} ${brand.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#content">Skip to content</a>
        <div id="content">{children}</div>
      </body>
    </html>
  );
}
