import Link from 'next/link';

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="MyVoteMatters home">
      <img className="brand-mark" src="/brand/logo-mark.png" alt="" width={34} height={34} aria-hidden="true" />
      <span>MyVote<span className="brand-accent">Matters</span></span>
    </Link>
  );
}
