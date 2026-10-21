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

export const SparkIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
    <path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7Z" />
  </svg>
);

/** Points left: in RTL that is the "forward" direction. */
export const SendIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="M21 3 3 10.5l7 2.5 2.5 7Z" transform="scale(-1 1) translate(-24 0)" />
  </svg>
);

/** Undo points right: in RTL that is "back". */
export const UndoIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="m15 6 4 4-4 4" />
    <path d="M19 10H9.5a5 5 0 0 0 0 10H12" />
  </svg>
);

export const RedoIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="m9 6-4 4 4 4" />
    <path d="M5 10h9.5a5 5 0 0 1 0 10H12" />
  </svg>
);

export const FitIcon = () => (
  <svg {...base} width={16} height={16}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const DownloadIcon = ({ size = 30 }: { size?: number }) => (
  <svg {...base} width={size} height={size}>
    <path d="M12 3v12M7 10l5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);
