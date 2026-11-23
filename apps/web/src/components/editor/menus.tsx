'use client';

// Menüs im Editor: das /-Menü mit den Standardblöcken plus Callout, Inhaltsverzeichnis, „Link auf
// Seite“ und „Person erwähnen“, die Seitensuche hinter „[“ (wie in Confluence), die Personensuche
// hinter „@“ und das Datei-Panel nur mit Hochladen (fremde Bild-Adressen lädt der Browser ohnehin
// nicht, CSP in next.config.ts).
import { useState } from 'react';
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

function slashItems(editor: Editor): DefaultReactSuggestionItem[] {
  const defaults = getDefaultReactSlashMenuItems(editor);
  // Callout gleich hinter dem Zitat, in dessen Gruppe
  const quote = defaults.findIndex((i) => i.aliases?.includes('quote') || i.title === 'Zitat');
  const group = quote >= 0 ? defaults[quote]!.group : undefined;
  const callout: DefaultReactSuggestionItem = {
    title: 'Callout',
    subtext: 'Hervorgehobener Kasten: Info, Hinweis, Erfolg, Warnung, Fehler',
    aliases: ['callout', 'hinweis', 'info', 'warnung', 'panel', 'kasten', 'note'],
    group,
    icon: <span aria-hidden>ℹ</span>,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: 'callout' });
    },
  };
  const pageLink: DefaultReactSuggestionItem = {
    title: 'Link auf Seite',
    subtext: `Eine andere Seite verlinken (auch mit „${PAGE_LINK_TRIGGER}“)`,
    aliases: ['link', 'seite', 'seitenlink', 'verlinken', 'page'],
    group,
    icon: <span aria-hidden>↗</span>,
    // Nach dem Schließen des /-Menüs die Seitensuche öffnen, als hätte man „[“ getippt
    onItemClick: () => {
      setTimeout(() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu(PAGE_LINK_TRIGGER), 0);
    },
  };
  const toc: DefaultReactSuggestionItem = {
    title: 'Inhaltsverzeichnis',
    subtext: 'Überschriften der Seite als Liste, aktualisiert sich selbst',
    aliases: ['inhaltsverzeichnis', 'inhalt', 'toc', 'verzeichnis', 'übersicht'],
    group,
    icon: <span aria-hidden>☰</span>,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: 'toc' });
    },
  };
  const mention: DefaultReactSuggestionItem = {
    title: 'Person erwähnen',
    subtext: `Eine Person aus dem Workspace nennen (auch mit „${MENTION_TRIGGER}“)`,
    aliases: ['erwähnen', 'person', 'mention', 'nennen'],
    group,
    icon: <span aria-hidden>@</span>,
    onItemClick: () => {
      setTimeout(() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu(MENTION_TRIGGER), 0);
    },
  };
  const at = quote >= 0 ? quote + 1 : defaults.length;
  return [...defaults.slice(0, at), callout, toc, pageLink, mention, ...defaults.slice(at)];
}

async function pageItems(editor: Editor, spaceKey: string, query: string): Promise<DefaultReactSuggestionItem[]> {
  const params = new URLSearchParams({ q: query, space: spaceKey });
  let hits: SearchHit[] = [];
  try {
    hits = await api<SearchHit[]>(`/pages/search?${params}`);
  } catch {
    hits = [];
  }
  return hits.map((h) => ({
    title: h.title || 'Ohne Titel',
    subtext: h.spaceKey === spaceKey.toUpperCase() ? undefined : `Space ${h.spaceKey}`,
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
  return (
    <>
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) => filterSuggestionItems(slashItems(editor), query)}
      />
      <SuggestionMenuController
        triggerCharacter={PAGE_LINK_TRIGGER}
        getItems={(query) => pageItems(editor, spaceKey, query)}
      />
      <SuggestionMenuController
        triggerCharacter={MENTION_TRIGGER}
        getItems={(query) => personItems(editor, spaceKey, query)}
      />
      <FilePanelController filePanel={UploadOnlyPanel} />
    </>
  );
}
