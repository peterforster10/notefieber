'use client';

// Einstellungen eines Spaces (E05): Name und Beschreibung ändern Space-Admins (app.update_space,
// nicht im archivierten Space), archivieren und zurückholen Space- und Organisations-Admins
// (app.archive_space; canManage, weil im archivierten Space auch Admins nur noch lesen). Der
// Schlüssel bleibt fest: Er steht in Adressen und kommt beim Import aus Confluence.
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { spacePath } from '@notefieber/shared';
import { api, queryKeys, type Space } from '@/lib/api';
import { useErrorText } from '@/lib/errors';

export function SpaceSettings({ space }: { space: Space }) {
  const t = useTranslations('settings');
  const common = useTranslations('common');
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description ?? '');
  const [saved, setSaved] = useState(false);
  const editable = space.role === 'admin' && !space.archived;

  // Rolle und Archiv wirken auf Space-Liste, Baum (Knöpfe) und offene Seite (Editor)
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.space(space.key) }),
      queryClient.invalidateQueries({ queryKey: ['spaces'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tree(space.key) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.pages }),
    ]);
  const save = useMutation({
    mutationFn: () =>
      api<Space>(`/spaces/${space.key}`, { method: 'PATCH', body: { name, description: description || null } }),
    onMutate: () => setSaved(false),
    onSuccess: async (s) => {
      setName(s.name);
      setDescription(s.description ?? '');
      setSaved(true);
      await refresh();
    },
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api<Space>(`/spaces/${space.key}/archive`, { method: 'POST', body: { archived } }),
    onMutate: () => setSaved(false),
    onSuccess: refresh,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <article className="nf-settings">
      <p className="nf-breadcrumb">
        <Link href={spacePath(space.key)}>{space.name}</Link> /
      </p>
      <h1>{t('title')}</h1>
      <p className="nf-muted">{t.rich('key', { code: (chunks) => <code>{chunks}</code>, key: space.key })}</p>

      <form onSubmit={submit}>
        <label className="nf-label" htmlFor="space-name">
          {common('name')}
        </label>
        <input
          id="space-name"
          className="nf-input nf-input-wide"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          disabled={!editable}
        />
        <label className="nf-label" htmlFor="space-description">
          {t('description')}
        </label>
        <textarea
          id="space-description"
          className="nf-input nf-input-wide"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          disabled={!editable}
        />
        {editable ? (
          <p>
            <button type="submit" className="nf-button" disabled={save.isPending || !name.trim()}>
              {common('save')}
            </button>
            {saved && <span className="nf-saved"> {t('saved')}</span>}
          </p>
        ) : (
          <p className="nf-muted">{space.archived ? t('archivedNoEdit') : t('adminsOnly')}</p>
        )}
        {save.isError && (
          <p role="alert" className="nf-alert">
            {errorText(save.error)}
          </p>
        )}
      </form>

      {space.canManage && (
        <section className="nf-form">
          <h2>{space.archived ? t('archivedTitle') : t('archiveTitle')}</h2>
          {space.archived ? (
            <>
              <p>{t('archivedText')}</p>
              <button
                type="button"
                className="nf-button"
                disabled={archive.isPending}
                onClick={() => archive.mutate(false)}
              >
                {t('unarchive')}
              </button>
            </>
          ) : (
            <>
              <p>{t('archiveText')}</p>
              <button
                type="button"
                className="nf-button nf-button-attention"
                disabled={archive.isPending}
                onClick={() => {
                  if (window.confirm(t('archiveConfirm', { name: space.name }))) {
                    archive.mutate(true);
                  }
                }}
              >
                {t('archive')}
              </button>
            </>
          )}
          {archive.isError && (
            <p role="alert" className="nf-alert">
              {errorText(archive.error)}
            </p>
          )}
        </section>
      )}
    </article>
  );
}
