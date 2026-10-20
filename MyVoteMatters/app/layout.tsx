import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Motion } from '@/components/Motion';

// Turns on entrance animations before first paint, unless the visitor prefers reduced motion.
const MOTION_INIT = "try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('motion')}catch(e){}";

export const metadata: Metadata = {
  title: { default: 'MyVoteMatters · Secure corporate e-voting', template: '%s · MyVoteMatters' },
  description: 'Run AGM resolutions, board elections and member votes with verified eligibility, secret ballots and reconciled results.',
  applicationName: 'MyVoteMatters',
  appleWebApp: { capable: true, title: 'MyVoteMatters', statusBarStyle: 'default' },
};

export const viewport: Viewport = { themeColor: '#10182f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: MOTION_INIT }} /></head>
      <body>{children}<Motion /></body>
    </html>
  );
}
