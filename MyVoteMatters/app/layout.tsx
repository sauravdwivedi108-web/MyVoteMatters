import type { Metadata, Viewport } from 'next';
import { Fraunces, IBM_Plex_Mono, Source_Sans_3 } from 'next/font/google';
import './globals.css';

const sans = Source_Sans_3({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Fraunces({ subsets: ['latin'], variable: '--font-serif', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'MyVoteMatters · Secure corporate e-voting', template: '%s · MyVoteMatters' },
  description: 'Run AGM resolutions, board elections and member votes with verified eligibility, secret ballots and reconciled results.',
  applicationName: 'MyVoteMatters',
  appleWebApp: { capable: true, title: 'MyVoteMatters', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#0e1c2f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#content">Skip to content</a>
        <div id="content">{children}</div>
      </body>
    </html>
  );
}
