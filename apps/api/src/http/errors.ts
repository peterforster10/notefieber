// Fehler der Datenbank in HTTP-Antworten übersetzen. Die Funktionen in app prüfen Rechte
// und Regeln selbst; die API reicht ihre Meldungen weiter, ohne Interna preiszugeben.
import { z } from 'zod';

export interface HttpError {
  status: number;
  body: { error: string; message?: string; issues?: unknown };
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

export function toHttpError(err: unknown): HttpError | undefined {
  if (err instanceof z.ZodError) {
    return { status: 400, body: { error: 'invalid_request', issues: err.issues } };
  }
  if (!isPgError(err)) return undefined;
  switch (err.code) {
    case '42501': // insufficient_privilege: Rechte reichen nicht
      return { status: 403, body: { error: 'forbidden', message: cleanMessage(err.message) } };
    case '23505': // unique_violation, z. B. Space-Schlüssel schon vergeben
      return { status: 409, body: { error: 'conflict', message: 'Schon vorhanden' } };
    case 'P0001': // raise_exception: fachliche Regel der Funktion
    case '23001': // restrict_violation: letzter Admin, letzter Owner
      return { status: 409, body: { error: 'rejected', message: cleanMessage(err.message) } };
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
