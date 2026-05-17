type AppIconProps = {
  size?: number;
  className?: string;
  label?: string;
};

export function AppIcon({
  size = 40,
  className = "",
  label,
}: AppIconProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`shrink-0 rounded-xl ${className}`}
    >
      <defs>
        <linearGradient id="appIconBg" x1="64" y1="56" x2="448" y2="456" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff8fa" />
          <stop offset=".34" stopColor="#fff9ed" />
          <stop offset=".66" stopColor="#f3f8ff" />
          <stop offset="1" stopColor="#fbf5ff" />
        </linearGradient>
        <linearGradient id="appIconCard" x1="154" y1="112" x2="376" y2="430" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#f6f8ff" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="104" fill="url(#appIconBg)" />
      <rect
        x="12"
        y="12"
        width="488"
        height="488"
        rx="92"
        fill="none"
        stroke="#dfe7ef"
        strokeWidth="16"
      />
      <path
        d="M100 356c42 44 112 70 186 58 82-13 140-71 162-143 19-61 7-125-30-171 56 34 94 94 94 163 0 109-92 197-206 197-84 0-162-41-206-104Z"
        fill="#172033"
        opacity=".08"
      />
      <g transform="rotate(-10 238 272)">
        <rect x="110" y="92" width="214" height="304" rx="29" fill="#dfe6ff" />
        <rect x="126" y="108" width="182" height="272" rx="20" fill="#8fb5f4" opacity=".16" />
      </g>
      <g transform="rotate(8 284 278)">
        <rect x="196" y="92" width="206" height="302" rx="29" fill="#f6e2a9" />
        <rect x="212" y="108" width="174" height="270" rx="20" fill="#c2851a" opacity=".14" />
      </g>
      <rect x="154" y="112" width="222" height="318" rx="34" fill="url(#appIconCard)" />
      <rect
        x="174"
        y="136"
        width="182"
        height="270"
        rx="22"
        fill="#fffef8"
        stroke="#17201d"
        strokeOpacity=".12"
        strokeWidth="8"
      />
      <rect x="198" y="164" width="134" height="34" rx="17" fill="#2563eb" opacity=".14" />
      <path
        d="M214 236h104M214 270h82"
        stroke="#17201d"
        strokeOpacity=".22"
        strokeWidth="18"
        strokeLinecap="round"
      />
      <g stroke="#17201d" strokeOpacity=".15" strokeWidth="5">
        <circle cx="220" cy="338" r="20" fill="#fffbd5" />
        <circle cx="265" cy="338" r="20" fill="#aae0fa" />
        <circle cx="310" cy="338" r="20" fill="#9bd3ae" />
      </g>
      <path
        d="M382 78 402 129 454 149 402 169 382 220 362 169 310 149 362 129 382 78Z"
        fill="#f4c15d"
      />
      <path
        d="M382 109 393 138 422 149 393 160 382 189 371 160 342 149 371 138 382 109Z"
        fill="#fff3d6"
      />
    </svg>
  );
}
