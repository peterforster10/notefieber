// Icons der Oberfläche als kleine SVG-Komponenten, Linien im 16er-Raster wie im Prototyp
// (prototype/pages/Main.dc.html, eigener Entwurf). Ohne `label` dekorativ (aria-hidden); mit
// `label` ein Bild mit Namen für Screenreader, z. B. das Schloss an eingeschränkten Seiten.
import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
  label?: string;
  className?: string;
}

function svg(children: ReactNode) {
  return function Icon({ size = 16, label, className }: IconProps) {
    return (
      <svg
        className={className ? `nf-icon ${className}` : 'nf-icon'}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        focusable="false"
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      >
        {label && <title>{label}</title>}
        {children}
      </svg>
    );
  };
}

export const PageIcon = svg(
  <>
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
  </>,
);
export const HomeIcon = svg(<path d="M2.5 7.5L8 3l5.5 4.5M4 6.5V13h3V9.5h2V13h3V6.5" />);
export const LockIcon = svg(
  <>
    <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
  </>,
);
export const PlusIcon = svg(<path d="M8 3v10M3 8h10" />);
export const ChevronRightIcon = svg(<path d="M6 4l4 4-4 4" />);
export const ChevronDownIcon = svg(<path d="M4 6l4 4 4-4" />);
export const UpDownIcon = svg(<path d="M5 6l3-3 3 3M5 10l3 3 3-3" />);
export const ClockIcon = svg(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4.5V8l2.5 1.5" />
  </>,
);
export const PeopleIcon = svg(
  <>
    <circle cx="6" cy="5.5" r="2.5" />
    <path d="M1.5 13.5c.5-2.5 2.3-4 4.5-4s4 1.5 4.5 4" />
    <path d="M10.5 3.2a2.5 2.5 0 010 4.6M12 9.8c1.3.6 2.2 1.9 2.5 3.7" />
  </>,
);
export const ExportIcon = svg(
  <>
    <path d="M8 3v7.5M4.5 7L8 10.5 11.5 7" />
    <path d="M3 11v2h10v-2" />
  </>,
);
export const TrashIcon = svg(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9" />);
export const PencilIcon = svg(<path d="M10.5 2.5l3 3-8 8h-3v-3z" />);
export const ArrowUpIcon = svg(<path d="M8 13V3M4.5 6.5L8 3l3.5 3.5" />);
export const ArrowDownIcon = svg(<path d="M8 3v10M4.5 9.5L8 13l3.5-3.5" />);
export const IndentIcon = svg(<path d="M3 3v10M6 8h7M10 5l3 3-3 3" />);
export const OutdentIcon = svg(<path d="M13 3v10M10 8H3M6 5L3 8l3 3" />);
export const MenuIcon = svg(<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />);
export const CloseIcon = svg(<path d="M4 4l8 8M12 4l-8 8" />);
export const ShieldIcon = svg(<path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" />);
export const InfoIcon = svg(
  <>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2V11M8 5v.01" />
  </>,
);
export const SettingsIcon = svg(
  <>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.7M8 12.55v1.7M1.75 8h1.7M12.55 8h1.7M3.58 3.58l1.2 1.2M11.22 11.22l1.2 1.2M3.58 12.42l1.2-1.2M11.22 4.78l1.2-1.2" />
    <circle cx="8" cy="8" r="4.25" />
  </>,
);
export const RestoreIcon = svg(<path d="M3.2 7.5a5 5 0 1 1 1.3 4.1M3 3.5v4h4" />);
export const SignOutIcon = svg(<path d="M9.5 3H3.5v10h6M7 8h6.5M11 5.5L13.5 8 11 10.5" />);

/** Drei Punkte (gefüllt, nicht als Linie) */
export function MoreIcon({ size = 16 }: { size?: number }) {
  return (
    <svg className="nf-icon" width={size} height={size} viewBox="0 0 16 16" focusable="false" aria-hidden>
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
