'use client';

// Gerüst jeder Seite (E15, CLAUDE.md Abschnitt 9): „Zum Inhalt springen“, links die helle
// Seitenleiste, rechts Kopfbereich und Inhalt. Ab 1024 px steht die Seitenleiste fest; darunter
// (Tablet hochkant, schmale Fenster) ist sie eine Schublade, die der Menü-Knopf im Kopfbereich
// öffnet. Offen ist der Inhalt dahinter inert; Esc, ein Klick daneben oder ein Seitenwechsel
// schließen sie, der Fokus geht dann an den Menü-Knopf zurück.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { CloseIcon, MenuIcon } from './icons';

const NARROW = '(max-width: 1023.98px)';
const SIDEBAR_ID = 'nf-sidebar';

interface Drawer {
  open: boolean;
  toggle(): void;
  close(): void;
}
const DrawerContext = createContext<Drawer | null>(null);
/** Der Menü-Knopf im Kopfbereich, damit der Fokus beim Schließen dorthin zurückgeht */
const DrawerButtonContext = createContext<RefObject<HTMLButtonElement | null> | null>(null);

function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

export function AppShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const t = useTranslations('shell');
  const narrow = useNarrow();
  const pathname = usePathname();
  const [wanted, setWanted] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  // Seitenwechsel (auch aus der Schublade heraus): zu
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setWanted(false);
  }
  const open = wanted && narrow;

  const close = useCallback(() => setWanted(false), []);
  const drawer = useMemo<Drawer>(() => ({ open, toggle: () => setWanted((w) => !w), close }), [open, close]);

  // Geöffnet: Fokus in die Schublade (auf „Schließen“). Geschlossen: zurück an den Menü-Knopf, aber
  // erst nach dem Rendern, wenn der Inhalt nicht mehr inert ist
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) nav.current?.querySelector<HTMLElement>('.nf-drawer-close')?.focus();
    else if (wasOpen.current) button.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <DrawerContext.Provider value={drawer}>
      <DrawerButtonContext.Provider value={button}>
        <div className="nf-shell" data-drawer={open ? 'open' : undefined}>
          <a href="#content" className="nf-skip">
            {t('skipToContent')}
          </a>
          <nav
            ref={nav}
            id={SIDEBAR_ID}
            className="nf-sidebar"
            aria-label={t('navigation')}
            onKeyDown={(e) => {
              if (open && e.key === 'Escape' && !e.defaultPrevented) close();
            }}
          >
            {sidebar}
          </nav>
          <div className="nf-backdrop" aria-hidden onClick={close} />
          <div className="nf-column" inert={open}>
            {children}
          </div>
        </div>
      </DrawerButtonContext.Provider>
    </DrawerContext.Provider>
  );
}

/** Oben in der Seitenleiste: Name des Mandanten (zur Übersicht) und in der Schublade „Schließen“ */
export function SidebarTop({ brand }: { brand: string }) {
  const t = useTranslations('shell');
  const drawer = useContext(DrawerContext);
  return (
    <div className="nf-sidebar-top">
      <Link href="/" className="nf-brand">
        {brand}
      </Link>
      <button
        type="button"
        className="nf-icon-button nf-drawer-close"
        aria-label={t('closeNavigation')}
        onClick={drawer?.close}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/**
 * Kopfbereich über dem Inhalt; unter 1024 px links der Menü-Knopf für die Schublade. Ohne Inhalt
 * (Startseite, Einladung) erscheint er nur dort, für den Menü-Knopf.
 */
export function Topbar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  const t = useTranslations('shell');
  const drawer = useContext(DrawerContext);
  const button = useContext(DrawerButtonContext);
  return (
    <header className={start || end ? 'nf-topbar' : 'nf-topbar nf-topbar-bare'}>
      <div className="nf-topbar-start">
        {drawer && (
          <button
            ref={button}
            type="button"
            className="nf-btn nf-btn-icon nf-drawer-open"
            aria-label={t('openNavigation')}
            aria-controls={SIDEBAR_ID}
            aria-expanded={drawer.open}
            onClick={drawer.toggle}
          >
            <MenuIcon />
          </button>
        )}
        {start}
      </div>
      {end && <div className="nf-topbar-end">{end}</div>}
    </header>
  );
}

/** Inhalt; Ziel von „Zum Inhalt springen“ */
export function Main({ children }: { children: ReactNode }) {
  return (
    <main id="content" tabIndex={-1} className="nf-main">
      <div className="nf-main-inner">{children}</div>
    </main>
  );
}
