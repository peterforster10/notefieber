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
      // Esc schließt nur den Dialog, nicht auch noch die Schublade, in der er geöffnet wurde
      onKeyDown={(e) => e.key === 'Escape' && e.stopPropagation()}
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

/**
 * Rückfrage vor einer Aktion (statt window.confirm): Titel als Frage, ein Satz dazu, „Abbrechen“ und
 * die Aktion. Der Fokus steht zuerst auf „Abbrechen“, damit Enter nichts aus Versehen auslöst.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel: string;
  /** danger: Löschen und Ähnliches (rot); attention: folgenreich, aber umkehrbar (orange) */
  tone?: 'danger' | 'attention';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const common = useTranslations('common');
  const cancel = useRef<HTMLButtonElement>(null);
  // Nach showModal() (Effekt im Dialog, läuft vorher) auf „Abbrechen“
  useEffect(() => {
    if (open) cancel.current?.focus();
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      footer={
        <>
          <button ref={cancel} type="button" className="nf-btn" onClick={onCancel}>
            {common('cancel')}
          </button>
          <button type="button" className={`nf-btn nf-btn-${tone}`} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}
