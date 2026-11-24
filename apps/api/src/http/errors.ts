// Fehler der Datenbank in HTTP-Antworten übersetzen. Die Funktionen in app prüfen Rechte
// und Regeln selbst; die API reicht ihre Meldungen weiter, ohne Interna preiszugeben.
//
// Antwort: { error, code?, message? }. `error` ist die Art (forbidden, rejected …), `code` die
// genaue Regel, wenn sie bekannt ist (DB_RULES). Die Oberfläche übersetzt nur error und code
// (apps/web/messages/, E15); `message` bleibt deutsch, für Logs und andere Aufrufer.
import { z } from 'zod';

export interface HttpError {
  status: number;
  body: { error: string; code?: string; message?: string; issues?: unknown };
}

interface PgError {
  code: string;
  message: string;
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && typeof (err as PgError).code === 'string' && 'severity' in err;
}

/** „move_page: Ziel liegt im Papierkorb“ → „Ziel liegt im Papierkorb“ */
function cleanMessage(message: string): string {
  return message.replace(/^[a-z_]+: /, '');
}

/**
 * Meldungen der Funktionen in app, die die Oberfläche heute auslösen kann, mit stabilem Code.
 * Schlüssel ist der Text genau wie im Schema; errors.test.ts prüft, dass es ihn dort gibt. Neue
 * Regeln, die die Oberfläche zeigt, kommen hierher und in apps/web/messages/ (errors.<code>).
 */
export const DB_RULES: Readonly<Record<string, string>> = {
  'create_page: Elternseite fehlt oder liegt in einem anderen Space': 'parent_missing',
  'create_page: Die Elternseite liegt im Papierkorb': 'parent_trashed',
  'create_page: Der Space ist archiviert': 'space_archived',
  'move_page: ungültige Position': 'invalid_position',
  'move_page: Seite liegt im Papierkorb': 'page_trashed',
  'move_page: Ziel liegt nicht im selben Space': 'target_other_space',
  'move_page: Ziel liegt im Papierkorb': 'target_trashed',
  'move_page: Eine Seite kann nicht unter sich selbst verschoben werden': 'move_into_self',
  'Die Seite verlässt einen Bereich mit eigenen Rechten, dafür ist dort die Rolle admin nötig':
    'leaves_restricted_area',
  'trash_page: Die Startseite eines Spaces kann nicht gelöscht werden': 'home_page_not_deletable',
  'Unter dieser Seite liegen Seiten, die du nicht bearbeiten darfst': 'subpages_not_editable',
  'restore_page: Nur die Seite, die gelöscht wurde, lässt sich wiederherstellen': 'restore_trash_root_only',
  'restore_page: Zuerst die Elternseite wiederherstellen': 'restore_parent_first',
  'Nur Workspace-Mitglieder (ohne Gäste) dürfen Spaces anlegen': 'guests_cannot_create_spaces',
};

function body(error: string, err: PgError): HttpError['body'] {
  const code = DB_RULES[err.message];
  return { error, ...(code ? { code } : {}), message: cleanMessage(err.message) };
}

export function toHttpError(err: unknown): HttpError | undefined {
  if (err instanceof z.ZodError) {
    return { status: 400, body: { error: 'invalid_request', issues: err.issues } };
  }
  if (!isPgError(err)) return undefined;
  switch (err.code) {
    case '42501': // insufficient_privilege: Rechte reichen nicht
      return { status: 403, body: body('forbidden', err) };
    case '23505': // unique_violation, z. B. Space-Schlüssel schon vergeben
      return { status: 409, body: { error: 'conflict', message: 'Schon vorhanden' } };
    case 'P0001': // raise_exception: fachliche Regel der Funktion
    case '23001': // restrict_violation: letzter Admin, letzter Owner
      return { status: 409, body: body('rejected', err) };
    case '23514': // check_violation
    case '23502': // not_null_violation
    case '23503': // foreign_key_violation: Verweis über Grenzen
    case '22001': // string_data_right_truncation
    case '22P02': // invalid_text_representation
      return { status: 400, body: { error: 'invalid_request', message: 'Ungültige Angaben' } };
    default:
      return undefined;
  }
}
