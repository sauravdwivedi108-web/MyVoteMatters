// MyVoteMatters mark, drawn in code: a voter whose raised arms form a tick,
// standing over a ballot slot. The badge settles, the tick draws itself and
// the voter's head drops in. With `loop` it repeats every few seconds.
export function AnimatedLogo({ size = 40, loop = false, className = '' }: { size?: number; loop?: boolean; className?: string }) {
  return (
    <svg className={`mvm-logo${loop ? ' mvm-loop' : ''} ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="mvm-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d379e" />
          <stop offset="0.55" stopColor="#2848c7" />
          <stop offset="1" stopColor="#18a999" />
        </linearGradient>
        <linearGradient id="mvm-gloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="mvm-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="mvm-badge-clip"><rect x="4" y="4" width="92" height="92" rx="26" /></clipPath>
      </defs>
      <g className="mvm-badge">
        <rect x="4" y="4" width="92" height="92" rx="26" fill="url(#mvm-bg)" />
        <rect x="4" y="4" width="92" height="92" rx="26" fill="url(#mvm-gloss)" />
        <g clipPath="url(#mvm-badge-clip)">
          <rect className="mvm-shine" x="-50" y="-10" width="34" height="120" fill="url(#mvm-sheen)" transform="skewX(-18)" />
        </g>
      </g>
      <rect className="mvm-slot" x="28" y="80" width="44" height="5" rx="2.5" fill="#fff" fillOpacity="0.4" />
      <path className="mvm-tick" d="M25 51l19 19 32-37" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      <circle className="mvm-head" cx="45" cy="38" r="7.5" fill="#8ff0dc" />
    </svg>
  );
}
