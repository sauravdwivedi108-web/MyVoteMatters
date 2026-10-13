import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'MyVoteMatters · Secure corporate e-voting', template: '%s · MyVoteMatters' },
  description: 'Run AGM resolutions, board elections and member votes with verified eligibility, secret ballots and reconciled results.',
  applicationName: 'MyVoteMatters',
  appleWebApp: { capable: true, title: 'MyVoteMatters', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#10182f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
