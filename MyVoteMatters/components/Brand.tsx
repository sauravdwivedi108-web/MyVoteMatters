import Link from 'next/link';
import { Vote } from 'lucide-react';

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="MyVoteMatters home">
      <span className="brand-mark" aria-hidden="true"><Vote size={18} strokeWidth={2.4} /></span>
      <span>MyVote<span className="brand-accent">Matters</span></span>
    </Link>
  );
}
