'use client';

// Editor-Schema im Browser: dasselbe wie in packages/editor-schema (Worker, Import, Export), nur
// Callout, Seitenlink, Erwähnung und Inhaltsverzeichnis mit eigener React-Darstellung. Die Configs
// (Typ, Eigenschaften, Inhalt) kommen unverändert aus dem gemeinsamen Paket, damit beide Seiten
// dieselben Dokumente lesen.
import { useEffect, useState } from 'react';
import { BlockNoteSchema } from '@blocknote/core';
import { createReactBlockSpec, createReactInlineContentSpec } from '@blocknote/react';
import { pagePath } from '@notefieber/shared';
import {
  CALLOUT_VARIANTS,
  blockSpecs as sharedBlockSpecs,
  calloutConfig,
  inlineContentSpecs as sharedInlineContentSpecs,
  mentionConfig,
  pageLinkConfig,
  tocConfig,
  type CalloutVariant,
} from '@notefieber/editor-schema';
import { useLinkedPage } from '@/lib/page-links';
import { useMentionedPerson } from '@/lib/people';

export const CALLOUT_ICONS: Record<CalloutVariant, string> = {
  info: 'ℹ',
  note: '✎',
  success: '✓',
  warning: '⚠',
  error: '✕',
};

/** Texte der eigenen Blöcke und Inline-Inhalte in der Sprache der Oberfläche (E15) */
export interface EditorTexts {
  untitled: string;
  calloutKind: string;
  callout: Record<CalloutVariant, string>;
  pageUnavailable: string;
  pageUnavailableHint: string;
  pageInTrash(title: string): string;
  mentionUnknown: string;
  mentionHidden: string;
  deactivated(name: string): string;
  toc: string;
  tocTitle: string;
  tocEmpty: string;
}

/**
 * Wie die Texte zu den Darstellungen kommen: wie beim Navigieren über eine Variable, die der Editor
 * setzt (page-editor.tsx), bevor er die Blöcke rendert; BlockNote rendert sie als eigene React-Bäume
 * (lib/lookups.ts). Ein Wechsel der Sprache baut den Editor neu auf.
 */
let texts: EditorTexts | undefined;
export function setEditorTexts(value: EditorTexts) {
  texts = value;
}
const tx = () => {
  if (!texts) throw new Error('setEditorTexts fehlt');
  return texts;
};

/**
 * Wie Seitenlinks navigieren: Die Darstellung im Editor hat keinen Zugriff auf den Router der App,
 * deshalb setzt der Editor ihn hier (page-editor.tsx). Ohne: normales Laden der Seite.
 */
let navigate: (href: string) => void = (href) => window.location.assign(href);
export function setPageLinkNavigator(fn: (href: string) => void) {
  navigate = fn;
}

const Callout = createReactBlockSpec(calloutConfig, {
  render: ({ block, editor, contentRef }) => {
    const variant = block.props.variant;
    const icon = CALLOUT_ICONS[variant];
    const label = tx().callout[variant];
    return (
      <div className="nf-callout" data-variant={variant}>
        <span className="nf-callout-icon" contentEditable={false}>
          {editor.isEditable ? (
            <select
              aria-label={tx().calloutKind}
              title={label}
              value={variant}
              onChange={(e) => editor.updateBlock(block, { props: { variant: e.target.value as CalloutVariant } })}
            >
              {CALLOUT_VARIANTS.map((v) => (
                <option key={v} value={v}>
                  {CALLOUT_ICONS[v]} {tx().callout[v]}
                </option>
              ))}
            </select>
          ) : (
            <span role="img" aria-label={label} title={label}>
              {icon}
            </span>
          )}
        </span>
        <div className="nf-callout-content" ref={contentRef} />
      </div>
    );
  },
});

function PageLinkChip({ pageId }: { pageId: string }) {
  const entry = useLinkedPage(pageId);
  if (entry === undefined) return <span className="nf-page-link nf-page-link-loading">…</span>;
  if (!entry.value) {
    return (
      <span className="nf-page-link nf-page-link-missing" title={tx().pageUnavailableHint}>
        {tx().pageUnavailable}
      </span>
    );
  }
  const page = entry.value;
  const href = pagePath(page.spaceKey, page);
  return (
    <a
      className={page.trashed ? 'nf-page-link nf-page-link-trashed' : 'nf-page-link'}
      href={href}
      title={page.trashed ? tx().pageInTrash(page.title) : `${page.title} (${page.spaceKey})`}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; // neuer Tab wie gewohnt
        e.preventDefault();
        navigate(href);
      }}
    >
      {page.title || tx().untitled}
    </a>
  );
}

const PageLink = createReactInlineContentSpec(pageLinkConfig, {
  render: ({ inlineContent }) => <PageLinkChip pageId={inlineContent.props.pageId} />,
});

function MentionChip({ userId }: { userId: string }) {
  const entry = useMentionedPerson(userId);
  if (entry === undefined) return <span className="nf-mention nf-mention-loading">@…</span>;
  if (!entry.value) {
    return (
      <span className="nf-mention nf-mention-missing" title={tx().mentionHidden}>
        @{tx().mentionUnknown}
      </span>
    );
  }
  const person = entry.value;
  return (
    <span
      className={person.deactivated ? 'nf-mention nf-mention-deactivated' : 'nf-mention'}
      title={person.deactivated ? tx().deactivated(person.displayName) : person.displayName}
    >
      @{person.displayName}
    </span>
  );
}

const Mention = createReactInlineContentSpec(mentionConfig, {
  render: ({ inlineContent }) => <MentionChip userId={inlineContent.props.userId} />,
});

interface Heading {
  id: string;
  level: number;
  text: string;
}

/** Text einer Überschrift für das Inhaltsverzeichnis (Links und Formatierung zählen mit) */
function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c: { text?: unknown; content?: unknown }) => (typeof c.text === 'string' ? c.text : inlineText(c.content)))
    .join('');
}

interface BlockLike {
  id: string;
  type: string;
  props: unknown;
  content?: unknown;
  children: readonly unknown[];
}

/** Was das Inhaltsverzeichnis vom Editor braucht (jedes Schema passt) */
interface TocEditor {
  readonly document: readonly BlockLike[];
  onChange(callback: () => void): () => void;
}

function collectHeadings(blocks: readonly BlockLike[]): Heading[] {
  const out: Heading[] = [];
  const walk = (list: typeof blocks) => {
    for (const b of list) {
      if (b.type === 'heading') {
        const text = inlineText(b.content).trim();
        if (text) out.push({ id: b.id, level: (b.props as { level?: number }).level ?? 1, text });
      }
      walk(b.children as typeof blocks);
    }
  };
  walk(blocks);
  return out;
}

/**
 * Inhaltsverzeichnis: aus den Überschriften der Seite, beim Anzeigen gebaut und bei jeder Änderung
 * (auch von anderen) nachgezogen. Klick springt zur Überschrift.
 */
function TableOfContents({ editor }: { editor: TocEditor }) {
  const [headings, setHeadings] = useState<Heading[]>(() => collectHeadings(editor.document));
  useEffect(() => {
    const update = () => {
      const next = collectHeadings(editor.document);
      setHeadings((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    update();
    return editor.onChange(update);
  }, [editor]);
  const top = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;
  return (
    <nav className="nf-toc" aria-label={tx().toc} contentEditable={false}>
      <p className="nf-toc-title">{tx().tocTitle}</p>
      {headings.length === 0 ? (
        <p className="nf-muted">{tx().tocEmpty}</p>
      ) : (
        <ol>
          {headings.map((h) => (
            <li key={h.id} style={{ marginLeft: `${(h.level - top) * 1.1}rem` }}>
              <a
                href={`#${h.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document
                    .querySelector(`[data-node-type="blockContainer"][data-id="${CSS.escape(h.id)}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              >
                {h.text}
              </a>
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

const Toc = createReactBlockSpec(tocConfig, {
  render: ({ editor }) => <TableOfContents editor={editor} />,
});

// Aus den rohen Blöcken des gemeinsamen Schemas, nicht aus sharedSchema.blockSpecs: Sonst gehen die
// Tastatur-Regeln verloren (Enter in Listen und im Code-Block, packages/editor-schema)
export const browserSchema = BlockNoteSchema.create({
  blockSpecs: { ...sharedBlockSpecs, callout: Callout(), toc: Toc() },
  inlineContentSpecs: { ...sharedInlineContentSpecs, pageLink: PageLink, mention: Mention },
});
export type BrowserSchema = typeof browserSchema;
