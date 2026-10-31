import { useId } from 'react';

export function HostAvatar({ name, speaking }: { name: string; speaking: boolean }) {
  const raw = useId().replace(/:/g, '');
  const skin = `skin-${raw}`;
  const jacket = `jacket-${raw}`;
  const blush = `blush-${raw}`;
  return (
    <div className={speaking ? 'host speaking' : 'host'}>
      <svg viewBox="0 0 360 460" role="img" aria-label={name}>
        <defs>
          <linearGradient id={skin} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd8c2" />
            <stop offset="1" stopColor="#e8ad90" />
          </linearGradient>
          <linearGradient id={jacket} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff5d4a" />
            <stop offset="1" stopColor="#9f2a1e" />
          </linearGradient>
          <radialGradient id={blush} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ff8b78" stopOpacity="0.7" />
            <stop offset="1" stopColor="#ff8b78" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="180" cy="436" rx="96" ry="12" fill="rgba(0,0,0,0.35)" />
        <path d="M58 318c18-78 52-104 122-104s104 26 122 104l18 128H40l18-128z" fill={`url(#${jacket})`} />
        <path d="M156 236c8 36 24 78 24 78s16-42 24-78c-14 10-34 10-48 0z" fill="#f6efe6" />
        <path d="M148 248h64l-8 34h-48l-8-34z" fill="#241812" opacity="0.18" />
        <path d="M162 214h36v40c0 12-8 20-18 20s-18-8-18-20v-40z" fill={`url(#${skin})`} />
        <path d="M96 168c8-78 160-78 168 0 8 70-16 108-84 112-68-4-92-42-84-112z" fill="#1a120e" />
        <ellipse cx="180" cy="168" rx="74" ry="82" fill={`url(#${skin})`} />
        <ellipse cx="108" cy="176" rx="12" ry="16" fill="#e8ad90" />
        <ellipse cx="252" cy="176" rx="12" ry="16" fill="#e8ad90" />
        <circle cx="252" cy="186" r="4" fill="#f0c27a" />
        <path d="M112 150c22-62 114-62 136 0-18-8-34 18-68 16-34 2-50-24-68-16z" fill="#1a120e" />
        <path d="M214 118c28 6 36 28 30 46" fill="none" stroke="#1a120e" strokeWidth="16" strokeLinecap="round" />
        <rect x="232" y="112" width="26" height="7" rx="3" fill="#f0c27a" transform="rotate(28 232 112)" />
        <g className="eyes">
          <ellipse cx="152" cy="172" rx="8" ry="10" fill="#241811" />
          <ellipse cx="208" cy="172" rx="8" ry="10" fill="#241811" />
          <circle cx="155" cy="168" r="2.4" fill="#fff" />
          <circle cx="211" cy="168" r="2.4" fill="#fff" />
        </g>
        <path d="M138 154q14-8 26 0" fill="none" stroke="#3a271c" strokeWidth="3" strokeLinecap="round" />
        <path d="M196 154q14-8 26 0" fill="none" stroke="#3a271c" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="132" cy="192" rx="16" ry="8" fill={`url(#${blush})`} />
        <ellipse cx="228" cy="192" rx="16" ry="8" fill={`url(#${blush})`} />
        <g className="mouth">
          <ellipse className="mouth-open" cx="180" cy="214" rx="13" ry="8" fill="#7a3040" />
          <path className="mouth-smile" d="M166 208q14 14 28 0" fill="none" stroke="#a24a55" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g transform="translate(246 300)">
          <rect x="8" y="0" width="18" height="42" rx="9" fill="#2a221c" />
          <rect x="12" y="8" width="10" height="18" rx="5" fill="#6a5b50" />
          <rect x="15" y="40" width="4" height="36" fill="#2a221c" />
          <path d="M8 20c-10 4-14 16-8 24" fill="none" stroke="#c9a06a" strokeWidth="3" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}
