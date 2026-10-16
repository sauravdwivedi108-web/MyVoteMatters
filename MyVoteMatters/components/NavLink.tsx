'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, CalendarCheck, ShieldCheck } from 'lucide-react';

const ICONS = { overview: LayoutDashboard, elections: CalendarCheck, team: ShieldCheck };

export function NavLink({ href, children, exact, icon }:
  { href: string; children: React.ReactNode; exact?: boolean; icon: keyof typeof ICONS }) {
  const path = usePathname();
  const active = exact ? path === href : path.startsWith(href);
  const Icon = ICONS[icon];
  return (
    <Link className="nav" href={href} aria-current={active ? 'page' : undefined}>
      <Icon size={18} aria-hidden="true" />{children}
    </Link>
  );
}
