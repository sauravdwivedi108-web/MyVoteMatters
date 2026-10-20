// Animated MyVoteMatters mark, drawn after the Magnific (Seedream 4.5) logo:
// the shield settles in, the ballot slides out of the slot, the tick draws
// itself and the gold seal pops with a sparkle. Plays on load and again on
// hover; with `loop` it keeps casting a vote every few seconds.
export function AnimatedLogo({ size = 40, loop = false, className = '' }: { size?: number; loop?: boolean; className?: string }) {
  return (
    <svg className={`mvm-logo${loop ? ' mvm-loop' : ''} ${className}`} width={size} height={size * 1.1} viewBox="0 0 100 110" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="mvm-shield" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d1630" />
          <stop offset="0.55" stopColor="#1a3a8f" />
          <stop offset="1" stopColor="#1677e0" />
        </linearGradient>
        <linearGradient id="mvm-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2848c7" />
          <stop offset="1" stopColor="#2a9bf0" />
        </linearGradient>
        <radialGradient id="mvm-gold" cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#ffe8a3" />
          <stop offset="0.6" stopColor="#e2b23f" />
          <stop offset="1" stopColor="#b7892f" />
        </radialGradient>
        <linearGradient id="mvm-shine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="mvm-shield-clip">
          <path d="M50 4C34 9 20 13 8 20v32c0 26 20 44 42 54 22-10 42-28 42-54V20C80 13 66 9 50 4z" />
        </clipPath>
        <clipPath id="mvm-below-slot">
          <rect x="0" y="41" width="100" height="69" />
        </clipPath>
      </defs>

      <g className="mvm-shield">
        <path d="M50 4C34 9 20 13 8 20v32c0 26 20 44 42 54 22-10 42-28 42-54V20C80 13 66 9 50 4z" fill="url(#mvm-rim)" />
        <path d="M50 9C36 13.5 24 17 13 23v29c0 23 17.5 39 37 48.5C69.5 91 87 75 87 52V23C76 17 64 13.5 50 9z" fill="url(#mvm-shield)" />
        <g clipPath="url(#mvm-shield-clip)">
          <rect className="mvm-shine" x="-40" y="0" width="30" height="110" fill="url(#mvm-shine)" transform="skewX(-18)" />
        </g>
      </g>

      <rect x="25" y="35" width="50" height="10" rx="3.5" fill="#24408f" />
      <rect x="28" y="37.5" width="44" height="5" rx="2" fill="#070b1a" />

      <g clipPath="url(#mvm-below-slot)">
        <g className="mvm-ballot">
          <path d="M33 40h34v38l-3.4 3-3.4-3-3.4 3-3.4-3-3.4 3-3.4-3-3.4 3-3.4-3-3.4 3L33 78z" fill="#f7f9fc" />
          <rect x="38" y="49" width="24" height="2.2" rx="1" fill="#d5dbe6" />
          <rect x="38" y="56" width="24" height="2.2" rx="1" fill="#d5dbe6" />
          <rect x="38" y="63" width="24" height="2.2" rx="1" fill="#d5dbe6" />
          <path className="mvm-tick" d="M37 61l8 8 18-19" fill="none" stroke="#14b3b9" strokeWidth="6.5" strokeLinecap="square" strokeLinejoin="miter" pathLength={1} />
        </g>
      </g>

      <g className="mvm-seal">
        <path d="M50 12l2.2 2.6 3.3-.9.6 3.4 3.3 1-1.4 3.1 2.3 2.5-3 1.7.1 3.4-3.4.1-1.6 3.1L50 30.4l-2.4 2.4-1.6-3.1-3.4-.1.1-3.4-3-1.7 2.3-2.5-1.4-3.1 3.3-1 .6-3.4 3.3.9z" fill="url(#mvm-gold)" />
        <circle cx="50" cy="22" r="5.6" fill="none" stroke="#9a6f1f" strokeWidth="0.8" />
        <path d="M50 17.6l1.3 2.9 3.1.3-2.4 2 .7 3.1-2.7-1.6-2.7 1.6.7-3.1-2.4-2 3.1-.3z" fill="#5a2f2a" />
      </g>

      <g fill="#fff6d6">
        <path className="mvm-spark mvm-spark-1" d="M63 10l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
        <path className="mvm-spark mvm-spark-2" d="M36 26l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
        <path className="mvm-spark mvm-spark-3" d="M70 70l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
      </g>
    </svg>
  );
}
