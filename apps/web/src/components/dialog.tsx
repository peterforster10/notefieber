'use client';

// Modaler Dialog mit dem nativen <dialog> und showModal(): Der Browser fängt den Fokus, schließt mit
// Esc, setzt den Rest der Seite inert und gibt den Fokus beim Schließen an den Auslöser zurück.
// Ein Klick auf den abgedunkelten Hintergrund schließt ebenfalls. Gestaltet wie der Rechte-Dialog
// im Prototyp (prototype/pages/Main.dc.html).
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CloseIcon } from './icons';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Knöpfe unten rechts; ohne Angabe nur „Schließen“ */
  footer?: ReactNode;
}) {
  const t = useTranslations('dialog');
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="nf-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onClick={(e) => {
        // Klick auf den Hintergrund: Ziel ist das <dialog> selbst, nicht sein Inhalt
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <>
          <div className="nf-dialog-head">
            <div>
              <h2 id={titleId} className="nf-dialog-title">
                {title}
              </h2>
              {description && (
                <p id={descriptionId} className="nf-dialog-description">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              className="nf-btn nf-btn-icon nf-dialog-close"
              aria-label={t('close')}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
          {children}
          <div className="nf-dialog-foot">
            {footer ?? (
              <button type="button" className="nf-btn" onClick={onClose} autoFocus>
                {t('close')}
              </button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
}
