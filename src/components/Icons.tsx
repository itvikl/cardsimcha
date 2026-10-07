const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const LogoIcon = () => (
  <svg {...base} width={20} height={20}>
    <rect x="5" y="3" width="14" height="18" rx="3" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </svg>
);

export const ArrowIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const SearchIcon = () => (
  <svg {...base} width={30} height={30}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const PenIcon = () => (
  <svg {...base} width={30} height={30}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const DownloadIcon = () => (
  <svg {...base} width={30} height={30}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);
