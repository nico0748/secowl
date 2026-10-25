interface P { size?: number }
const base = (size = 22) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const })

export const IconHome = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>
)
export const IconRadar = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12 18 6" /></svg>
)
export const IconSearch = ({ size }: P) => (
  <svg {...base(size)}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
)
export const IconAlert = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 3.5 21 19.5H3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>
)
export const IconReport = ({ size }: P) => (
  <svg {...base(size)}><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" /><path d="M14 3v4h4" /><path d="M9 13h6M9 17h4" /></svg>
)
export const IconGear = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>
)
export const IconPlus = ({ size }: P) => (
  <svg {...base(size ?? 18)}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconHelp = ({ size }: P) => (
  <svg {...base(size ?? 20)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.8.7-.8 1.3v.3" /><path d="M12 17h.01" /></svg>
)

export const IconToolbox = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 9.5h18V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M9 9.5V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3.5" /><path d="M3 13.5h6M15 13.5h6" /><path d="M9 12v3h6v-3" /></svg>
)

export const IconTerminal = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="m7.5 9.5 3 2.5-3 2.5" /><path d="M13 15h4" /></svg>
)
