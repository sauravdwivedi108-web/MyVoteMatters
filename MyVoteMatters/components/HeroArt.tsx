// Flat illustration for the home hero, drawn in code: a voter reaching up to a
// big ballot screen, with a sealed vote envelope, a security bubble, a star
// bubble, a result chart, a cloud and a plant. Decorative only.
export function HeroArt({ className = '' }: { className?: string }) {
  return (
    <svg className={`hero-art ${className}`} viewBox="0 0 600 520" aria-hidden="true" focusable="false">
      {/* Ground shadows */}
      <ellipse cx="96" cy="452" rx="64" ry="12" fill="#2b2160" opacity=".12" />
      <ellipse cx="214" cy="492" rx="72" ry="13" fill="#2b2160" opacity=".14" />

      {/* Star bubble */}
      <g className="art-float art-d1">
        <g transform="translate(-34 -18)">
          <path d="M196 156l38 34-6-46z" fill="#c3d6ea" />
          <circle cx="168" cy="108" r="58" fill="#d6e5f3" />
          <path d="M168 66l12.3 25 27.7 4-20 19.5 4.7 27.5-24.7-13-24.7 13 4.7-27.5-20-19.5 27.7-4z" fill="#ffc914" />
          <path d="M168 66l12.3 25 27.7 4-20 19.5 4.7 27.5-24.7-13z" fill="#f0b400" />
        </g>
      </g>

      {/* Ballot screen */}
      <g className="art-screen">
        <rect x="262" y="58" width="188" height="330" rx="16" fill="#fff" />
        <rect x="276" y="72" width="160" height="50" rx="8" fill="#ffc914" />
        <circle cx="304" cy="97" r="14" fill="#fff" />
        <circle cx="356" cy="97" r="14" fill="#fff" />
        <circle cx="408" cy="97" r="14" fill="#fff" />
        <rect x="276" y="134" width="160" height="128" rx="8" fill="#d6e5f3" />
        <circle cx="356" cy="198" r="42" fill="#b4c9df" />
        <path className="art-tick" d="M336 199l14 14 26-30" fill="none" stroke="#fff" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
        <rect x="276" y="280" width="20" height="20" rx="5" fill="#ff5fa8" />
        <path d="M280.5 290l4 4 7-8" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <rect className="art-bar" x="304" y="282" width="132" height="16" rx="5" fill="#ff5fa8" />
        <rect x="276" y="314" width="20" height="20" rx="5" fill="none" stroke="#a98ee0" strokeWidth="3" />
        <rect className="art-bar art-d1" x="304" y="316" width="100" height="16" rx="5" fill="#a98ee0" />
        <rect x="276" y="348" width="20" height="20" rx="5" fill="none" stroke="#ff8cc2" strokeWidth="3" />
        <rect className="art-bar art-d2" x="304" y="350" width="116" height="16" rx="5" fill="#ff8cc2" />
      </g>

      {/* Security bubble */}
      <g className="art-float art-d2">
        <path d="M512 130l-40 30 50-8z" fill="#fff" />
        <circle cx="526" cy="82" r="56" fill="#fff" />
        <path d="M526 50l30 11v20c0 20-13 33-30 40-17-7-30-20-30-40V61z" fill="#ff5fa8" />
        <path d="M526 50l30 11v20c0 20-13 33-30 40z" fill="#e84a93" />
        <path d="M513 84l9 9 17-19" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Sealed vote envelope */}
      <g className="art-float art-d3">
        <rect x="452" y="178" width="132" height="92" rx="12" fill="#ffc914" />
        <path d="M452 190l66 46 66-46" fill="none" stroke="#d29e00" strokeWidth="5" strokeLinejoin="round" />
        <path d="M452 262l46-36M584 262l-46-36" stroke="#d29e00" strokeWidth="5" strokeLinecap="round" />
        <circle cx="518" cy="236" r="11" fill="#ff5fa8" />
      </g>

      {/* Cloud */}
      <path d="M470 352h108a20 20 0 0 0-6-39 30 30 0 0 0-55-12 22 22 0 0 0-36 13 19 19 0 0 0-11 38z" fill="#fff" opacity=".95" />

      {/* Result chart */}
      <g>
        <rect x="430" y="370" width="160" height="118" rx="14" fill="#d6e5f3" />
        <rect className="art-col" x="448" y="408" width="12" height="66" rx="6" fill="#ff5fa8" />
        <rect className="art-col art-d1" x="468" y="420" width="12" height="54" rx="6" fill="#ffc914" />
        <rect className="art-col art-d2" x="488" y="440" width="12" height="34" rx="6" fill="#8a5ce0" />
        <rect className="art-col art-d3" x="508" y="414" width="12" height="60" rx="6" fill="#ff5fa8" />
        <rect className="art-col art-d1" x="528" y="392" width="12" height="82" rx="6" fill="#ffc914" />
        <rect className="art-col art-d2" x="548" y="428" width="12" height="46" rx="6" fill="#8a5ce0" />
        <rect className="art-col art-d3" x="568" y="410" width="12" height="64" rx="6" fill="#ff5fa8" />
      </g>

      {/* Plant */}
      <g>
        <path d="M96 352c-30-30-40-62-38-86 18 22 34 52 38 86z" fill="#6c55a8" />
        <path d="M96 352c-8-42-2-82 12-104 4 34 0 72-12 104z" fill="#5a4594" />
        <path d="M96 352c18-34 40-56 64-64-12 26-34 50-64 64z" fill="#7a63b8" />
        <path d="M96 352c-24-14-50-18-72-12 20 14 44 18 72 12z" fill="#5a4594" />
        <path d="M60 350h72l-10 92H70z" fill="#b4c9df" />
        <rect x="56" y="344" width="80" height="14" rx="4" fill="#d6e5f3" />
      </g>

      {/* Voter */}
      <g className="art-voter">
        <path d="M182 474h34v14h-46c0-8 5-14 12-14z" fill="#5a3f9e" />
        <path d="M222 474h30c8 0 12 6 12 14h-42z" fill="#6d4fbb" />
        <path d="M184 336h28l4 140h-30z" fill="#d6e5f3" />
        <path d="M212 336h26l-4 140h-24z" fill="#b4c9df" />
        <path d="M228 246l36-46" stroke="#f2b896" strokeWidth="15" strokeLinecap="round" />
        <circle cx="266" cy="196" r="10" fill="#f2b896" />
        <path d="M176 262c0-20 12-34 32-34h8c20 0 28 16 28 34v84h-68z" fill="#7452b0" />
        <path d="M222 232c16 2 24 12 22 28l-14 4c-6-12-8-22-8-32z" fill="#5c3f96" />
        <path d="M200 216h18v18h-18z" fill="#f2b896" />
        <circle cx="212" cy="194" r="26" fill="#f2b896" />
        <path d="M186 192c-2-22 12-36 30-36 16 0 28 10 28 24h-26c-4 0-6 4-6 8v12h-8c0-6-4-10-10-8z" fill="#4f6a8a" />
        <circle cx="206" cy="198" r="5" fill="#e9a37f" />
      </g>
    </svg>
  );
}
