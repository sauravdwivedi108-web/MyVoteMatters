'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

// Keep in sync with the html.motion :is(...) list in globals.css.
export const REVEAL = '.main .card, .main .page-head, .main .meeting-card, .main .stat, .main .question, .main .choice, .main .notice, .main .table-wrap, .feature, .flow li, .role-card, .steps li, .trust-list li, .band, .auth-card, .voter .card, .tracker li';

// Fades page sections in as they scroll into view, a few at a time.
export function Motion() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains('motion')) return;
    if (!('IntersectionObserver' in window)) { root.classList.remove('motion'); return; }
    root.classList.add('motion-ready');
    const io = new IntersectionObserver((entries) => {
      const shown = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
      shown.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left);
      shown.forEach((el, i) => {
        el.style.setProperty('--rv-i', String(Math.min(i, 6)));
        el.classList.add('rv-in');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    const scan = () => document.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
      if (!el.classList.contains('rv-in') && !el.dataset.rv) { el.dataset.rv = '1'; io.observe(el); }
    });
    scan();
    let t = 0;
    const mo = new MutationObserver(() => { cancelAnimationFrame(t); t = requestAnimationFrame(scan); });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); cancelAnimationFrame(t); };
  }, [pathname]);
  return null;
}
