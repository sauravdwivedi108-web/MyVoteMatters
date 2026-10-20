import Link from 'next/link';
import { AnimatedLogo } from './AnimatedLogo';

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="MyVoteMatters home">
      <AnimatedLogo size={38} />
      <span>MyVote<span className="brand-accent">Matters</span></span>
    </Link>
  );
}
