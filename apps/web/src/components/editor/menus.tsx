'use client';

// Menüs im Editor: das /-Menü mit den Standardblöcken plus Callout, Inhaltsverzeichnis, „Link auf
// Seite“ und „Person erwähnen“, die Seitensuche hinter „[“ (wie in Confluence), die Personensuche
// hinter „@“ und das Datei-Panel nur mit Hochladen (fremde Bild-Adressen lädt der Browser ohnehin
// nicht, CSP in next.config.ts).
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BlockNoteEditor } from '@blocknote/core';
import { SuggestionMenu, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import {
  FilePanel,
  FilePanelController,
  SuggestionMenuController,
  UploadTab,
  getDefaultReactSlashMenuItems,
  useDictionary,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { api } from '@/lib/api';
import type { BrowserSchema } from './schema';

type Editor = BlockNoteEditor<
  BrowserSchema['blockSchema'],
  BrowserSchema['inlineContentSchema'],
  BrowserSchema['styleSchema']
>;

/** Zeichen, das die Seitensuche öffnet */
export const PAGE_LINK_TRIGGER = '[';
/** Zeichen, das die Personensuche öffnet */
export const MENTION_TRIGGER = '@';

interface PersonHit {
  id: string;
  displayName: string;
}

interface SearchHit {
  id: string;
  title: string;
  spaceKey: string;
}

type T = ReturnType<typeof useTranslations<'editor'>>;

// Aliase der eigenen Einträge in beiden Sprachen: „/hinweis“ und „/note“ gehen immer
function slashItems(editor: Editor, t: T): DefaultReactSuggestionItem[] {
  const defaults = getDefaultReactSlashMenuItems(editor);
  // Callout gleich hinter dem Zitat, in dessen Gruppe; erkannt am Titel aus dem Wörterbuch des Editors
  // (Titel und Aliase hängen von der Sprache ab)
  const quote = defaults.findIndex((i) => i.title === editor.dictionary.slash_menu.quote.title);
  const group = quote >= 0 ? defaults[quote]!.group : undefined;
  const callout: DefaultReactSuggestionItem = {
    title: t('slashCallout'),
    subtext: t('slashCalloutHint'),
    aliases: ['callout', 'hinweis', 'info', 'warnung', 'panel', 'kasten', 'note', 'warning', 'box'],
    group,
    icon: <span aria-hidden>ℹ</span>,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' });
    },
  };
  const pageLink: DefaultReactSuggestionItem = {
    title: t('slashPageLink'),
    subtext: t('slashPageLinkHint', { trigger: PAGE_LINK_TRIGGER }),
    aliases: ['link', 'seite', 'seitenlink', 'verlinken', 'page', 'pagelink'],
    group,
    icon: <span aria-hidden>↗</span>,
    // Nach dem Schließen des /-Menüs die Seitensuche öffnen, als hätte man „[“ getippt
    onItemClick: () => {
      setTimeout(() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu(PAGE_LINK_TRIGGER), 0);
    },
  };
  const toc: DefaultReactSuggestionItem = {
    title: t('slashToc'),
    subtext: t('slashTocHint'),
    aliases: ['inhaltsverzeichnis', 'inhalt', 'toc', 'verzeichnis', 'übersicht', 'contents', 'table of contents'],
    group,
    icon: <span aria-hidden>☰</span>,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: 'toc' });
    },
  };
  const mention: DefaultReactSuggestionItem = {
    title: t('slashMention'),
    subtext: t('slashMentionHint', { trigger: MENTION_TRIGGER }),
    aliases: ['erwähnen', 'person', 'mention', 'nennen', 'people'],
    group,
    icon: <span aria-hidden>@</span>,
    onItemClick: () => {
      setTimeout(() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu(MENTION_TRIGGER), 0);
    },
  };
  const at = quote >= 0 ? quote + 1 : defaults.length;
  return [...defaults.slice(0, at), callout, toc, pageLink, mention, ...defaults.slice(at)];
}

async function pageItems(
  editor: Editor,
  t: T,
  untitled: string,
  spaceKey: string,
  query: string,
): Promise<DefaultReactSuggestionItem[]> {
  const params = new URLSearchParams({ q: query, space: spaceKey });
  let hits: SearchHit[] = [];
  try {
    hits = await api<SearchHit[]>(`/pages/search?${params}`);
  } catch {
    hits = [];
  }
  return hits.map((h) => ({
    title: h.title || untitled,
    subtext: h.spaceKey === spaceKey.toUpperCase() ? undefined : t('searchOtherSpace', { key: h.spaceKey }),
    onItemClick: () => {
      editor.insertInlineContent([{ type: 'pageLink', props: { pageId: h.id } }, ' ']);
    },
  }));
}

async function personItems(editor: Editor, spaceKey: string, query: string): Promise<DefaultReactSuggestionItem[]> {
  const params = new URLSearchParams({ q: query, space: spaceKey });
  let hits: PersonHit[] = [];
  try {
    hits = await api<PersonHit[]>(`/people/search?${params}`);
  } catch {
    hits = [];
  }
  return hits.map((h) => ({
    title: h.displayName,
    onItemClick: () => {
      editor.insertInlineContent([{ type: 'mention', props: { userId: h.id } }, ' ']);
    },
  }));
}

/** Datei-Panel nur mit dem Reiter „Hochladen“ */
function UploadOnlyPanel({ blockId }: { blockId: string }) {
  const dict = useDictionary();
  const [, setLoading] = useState(false);
  return (
    <FilePanel
      blockId={blockId}
      tabs={[{ name: dict.file_panel.upload.title, tabPanel: <UploadTab blockId={blockId} setLoading={setLoading} /> }]}
    />
  );
}

export function EditorMenus({ editor, spaceKey }: { editor: Editor; spaceKey: string }) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  return (
    <>
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => filterSuggestionItems(slashItems(editor, t), query)}
      />
      <SuggestionMenuController
        triggerCharacter={PAGE_LINK_TRIGGER}
        getItems={(query) => pageItems(editor, t, common('untitled'), spaceKey, query)}
      />
      <SuggestionMenuController
        triggerCharacter={MENTION_TRIGGER}
        getItems={(query) => personItems(editor, spaceKey, query)}
      />
      <FilePanelController filePanel={UploadOnlyPanel} />
    </>
  );
}
