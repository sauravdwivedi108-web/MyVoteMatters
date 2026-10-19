import { Suspense } from 'react';
import { SiteNav, SiteFooter } from '@/components/SiteChrome';
import { VerifyForm } from './VerifyForm';

export const metadata = { title: 'Verify a receipt' };

export default function Verify() {
  return (
    <>
      <SiteNav />
      <main className="section" style={{ maxWidth: 620 }}>
        <h1>Verify a vote receipt</h1>
        <p className="muted">Check that a ballot was accepted. The receipt proves acceptance only; the receipt alone never reveals how anyone voted.</p>
        <Suspense><VerifyForm /></Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
