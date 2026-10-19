import Link from 'next/link';

export function Brand({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label="MyVoteMatters home">
      <span className="brand-mark" aria-hidden="true">
        <img src="/crest.svg" alt="" width={28} height={28} />
      </span>
      <span>MyVote<span className="brand-accent">Matters</span></span>
    </Link>
  );
}
