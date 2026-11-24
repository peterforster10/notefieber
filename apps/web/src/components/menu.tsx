'use client';

// Menü hinter einem Knopf (ARIA-Muster „Menu Button“): Space-Umschalter und Aktionen einer Zeile im
// Seitenbaum. Tastatur: Enter, Leertaste oder ↓ öffnen und springen zum ersten Eintrag, ↑ zum
// letzten; im Menü ↑/↓, Pos1/Ende, Esc und Tab schließen und geben den Fokus an den Knopf zurück.
// Das Menü hängt am Ende von <body> (Portal) und steht fest über dem Knopf, damit es weder die
// scrollende Seitenleiste noch die Schublade (transform) abschneidet.
//
// Untermenü (z. B. Einstellungen eines Spaces im Space-Umschalter): Ein Eintrag mit `submenu`
// bekommt rechts einen Knopf „⋯“ (sichtbar beim Darüberfahren, mit dem Fokus und auf Touch-Geräten).
// Er ist selbst ein Menüeintrag (↑/↓ erreichen ihn) und klappt das Untermenü nach rechts aus; → auf
// dem Eintrag oder dem Knopf öffnet es ebenfalls, ← oder Esc schließen es wieder.
import Link from 'next/link';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreIcon } from './icons';

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Link statt Aktion */
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Tastenkürzel zur Anzeige, z. B. „F2“ oder „Entf“ */
  shortcut?: string;
  /** Dasselbe Kürzel für Screenreader (aria-keyshortcuts), z. B. „Delete“ */
  keys?: string;
  danger?: boolean;
  /** Aktueller Eintrag, z. B. der geöffnete Space */
  current?: boolean;
  separatorBefore?: boolean;
  /** Untermenü hinter „⋯“ am Eintrag; `label` ist der Name des Knopfs, z. B. „Aktionen für Entwicklung“ */
  submenu?: { label: string; items: MenuItem[] };
}

interface Position {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

const MENU_MAX_HEIGHT = 420;
const SUBMENU_WIDTH = 240;

/** Offenes Untermenü: zu welchem Eintrag, und ob der Fokus hinein soll (Tastatur) */
interface Sub {
  key: string;
  focus: boolean;
}

export function MenuButton({
  items,
  label,
  className,
  children,
  align = 'start',
  tabIndex,
  onOpenChange,
}: {
  items: MenuItem[];
  /** Name des Knopfs für Screenreader, wenn er nur ein Icon zeigt */
  label?: string;
  className?: string;
  children: ReactNode;
  /** Menü links bündig mit dem Knopf (start) oder rechts (end) */
  align?: 'start' | 'end';
  tabIndex?: number;
  onOpenChange?: (open: boolean) => void;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const subMenu = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<false | 'first' | 'last'>(false);
  const [pos, setPos] = useState<Position>({});
  const [sub, setSub] = useState<Sub | null>(null);
  const [subPos, setSubPos] = useState<Position>({});

  const change = useCallback(
    (next: false | 'first' | 'last', refocus = false) => {
      setOpen(next);
      setSub(null);
      onOpenChange?.(!!next);
      if (!next && refocus) button.current?.focus();
    },
    [onOpenChange],
  );

  // Platz unter dem Knopf, sonst darüber; links oder rechts bündig
  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const vertical =
      below >= Math.min(MENU_MAX_HEIGHT, 240) || below >= r.top
        ? { top: r.bottom + 4 }
        : { bottom: window.innerHeight - r.top + 4 };
    const horizontal =
      align === 'end' ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) };
    setPos({ ...vertical, ...horizontal });
  }, [open, align]);

  const entries = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const subEntries = () => [...(subMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const moreButton = (key: string) =>
    menu.current?.querySelector<HTMLElement>(`[data-submenu="${CSS.escape(key)}"]`) ?? undefined;
  const inside = (t: Node) => !!(menu.current?.contains(t) || subMenu.current?.contains(t));

  /** Untermenü öffnen: rechts neben seinem Eintrag, ohne Platz links davon; `focus` per Tastatur */
  function openSub(key: string, focus: boolean) {
    const row = moreButton(key)?.closest('li');
    if (!row) return;
    const r = row.getBoundingClientRect();
    const right = r.right + 4 + SUBMENU_WIDTH <= window.innerWidth;
    setSubPos({
      top: Math.max(8, Math.min(r.top - 4, window.innerHeight - 120)),
      ...(right ? { left: r.right + 4 } : { right: Math.max(8, window.innerWidth - r.left + 4) }),
    });
    setSub({ key, focus });
  }
  useEffect(() => {
    if (sub?.focus) subEntries()[0]?.focus();
  }, [sub]);

  function closeSub(refocus: boolean) {
    const key = sub?.key;
    setSub(null);
    if (refocus && key) moreButton(key)?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const all = entries();
    (open === 'last' ? all.at(-1) : all[0])?.focus();
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!inside(t) && !button.current?.contains(t)) change(false);
    };
    const away = (e: Event) => {
      if (e.target instanceof Node && inside(e.target)) return;
      change(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [open, change]);

  function onMenuKey(e: React.KeyboardEvent) {
    const all = entries();
    const active = document.activeElement as HTMLElement;
    const i = all.indexOf(active);
    const focus = (n: number) => {
      setSub(null);
      all[(n + all.length) % all.length]?.focus();
    };
    switch (e.key) {
      case 'ArrowRight': {
        // Auf einem Eintrag mit Untermenü oder seinem „⋯“: Untermenü öffnen, Fokus hinein
        const key =
          active.dataset.submenu ?? active.closest('li')?.querySelector<HTMLElement>('[data-submenu]')?.dataset.submenu;
        if (!key) return;
        openSub(key, true);
        break;
      }
      case 'ArrowDown':
        focus(i + 1);
        break;
      case 'ArrowUp':
        focus(i - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(all.length - 1);
        break;
      case 'Escape':
      case 'Tab':
        change(false, true);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function onSubKey(e: React.KeyboardEvent) {
    const all = subEntries();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const focus = (n: number) => all[(n + all.length) % all.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        focus(i + 1);
        break;
      case 'ArrowUp':
        focus(i - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(all.length - 1);
        break;
      case 'ArrowLeft':
      case 'Escape':
        closeSub(true);
        break;
      case 'Tab':
        change(false, true);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function select(item: MenuItem) {
    if (item.disabled) return;
    change(false, true);
    item.onSelect?.();
  }

  const subItem = sub ? items.find((i) => i.key === sub.key) : undefined;

  return (
    <>
      <button
        ref={button}
        id={`${id}-button`}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-controls={open ? id : undefined}
        tabIndex={tabIndex}
        onClick={() => change(open ? false : 'first')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            change(e.key === 'ArrowUp' ? 'last' : 'first');
          }
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <ul
            ref={menu}
            id={id}
            role="menu"
            aria-labelledby={`${id}-button`}
            className="nf-menu"
            style={pos}
            onKeyDown={onMenuKey}
          >
            {items.map((item) => (
              <li key={item.key} role="none" className={item.submenu ? 'nf-menu-row' : undefined}>
                {item.separatorBefore && <div className="nf-menu-separator" role="separator" />}
                <Entry item={item} onSelect={select} />
                {item.submenu && (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="nf-menu-more"
                    data-submenu={item.key}
                    aria-label={item.submenu.label}
                    title={item.submenu.label}
                    aria-haspopup="menu"
                    aria-expanded={sub?.key === item.key}
                    aria-controls={sub?.key === item.key ? `${id}-sub` : undefined}
                    onClick={() => (sub?.key === item.key ? setSub(null) : openSub(item.key, false))}
                  >
                    <MoreIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>,
          document.body,
        )}
      {open &&
        subItem?.submenu &&
        createPortal(
          <ul
            ref={subMenu}
            id={`${id}-sub`}
            role="menu"
            aria-label={subItem.submenu.label}
            className="nf-menu nf-submenu"
            style={subPos}
            onKeyDown={onSubKey}
          >
            {subItem.submenu.items.map((item) => (
              <li key={item.key} role="none">
                {item.separatorBefore && <div className="nf-menu-separator" role="separator" />}
                <Entry item={item} onSelect={select} />
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}

/** Ein Eintrag: Link oder Aktion */
function Entry({ item, onSelect }: { item: MenuItem; onSelect: (item: MenuItem) => void }) {
  if (item.href && !item.disabled) {
    return (
      <Link
        href={item.href}
        role="menuitem"
        tabIndex={-1}
        className="nf-menu-item"
        aria-current={item.current || undefined}
        onClick={() => onSelect(item)}
      >
        <ItemContent item={item} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={`nf-menu-item${item.danger ? ' nf-menu-item-danger' : ''}`}
      aria-disabled={item.disabled || undefined}
      aria-keyshortcuts={item.keys}
      onClick={() => onSelect(item)}
    >
      <ItemContent item={item} />
    </button>
  );
}

function ItemContent({ item }: { item: MenuItem }) {
  return (
    <>
      {item.icon}
      <span className="nf-menu-label">{item.label}</span>
      {item.shortcut && (
        <kbd className="nf-menu-shortcut" aria-hidden>
          {item.shortcut}
        </kbd>
      )}
    </>
  );
}
