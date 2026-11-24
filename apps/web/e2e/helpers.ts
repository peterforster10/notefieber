// Gemeinsames für die End-to-End-Prüfungen: Anmelden als Testperson und Seiten über die API anlegen.
import { expect, type Page } from '@playwright/test';
import { pagePath } from '@notefieber/shared';

export const BASE_URL = process.env.NF_E2E_URL ?? 'http://localhost:3000';
/**
 * Login über die API, an der Zitadel den Rücksprung kennt (OIDC_REDIRECT_URI, lokal Port 3000).
 * Das Sitzungs-Cookie gilt für den Host, nicht den Port: Danach ist die Person auch auf einem
 * Produktions-Build unter einem anderen Port angemeldet.
 */
export const LOGIN_URL = process.env.NF_E2E_LOGIN_URL ?? BASE_URL;
/** Testperson aus seed.sql und docker/zitadel/init.mjs: Admin im Space ENTW */
export const USER = process.env.NF_E2E_USER ?? 'peter.forster@alpenwerk.example';
const PASSWORD = process.env.NF_TEST_PASSWORD ?? 'NoteFieber-lokal-1';
const TENANT = process.env.NF_E2E_TENANT ?? 'alpenwerk';

/** Anmelden über die Anmeldeseite von Zitadel, wie eine Person es tut */
export async function signIn(page: Page): Promise<void> {
  const login = new URL(LOGIN_URL);
  await page.goto(`${login.origin}/api/v1/auth/login?tenant=${TENANT}&returnTo=%2F`);
  const name = page.locator('input[name="loginName"], input[autocomplete="username"], input[type="email"]').first();
  await name.fill(USER);
  await name.press('Enter');
  const password = page.locator('input[type="password"]');
  await password.fill(PASSWORD);
  await password.press('Enter');
  await page.waitForURL((url) => url.origin === login.origin && !url.pathname.startsWith('/api/'), { timeout: 30_000 });
  const me = await page.request.get(`${BASE_URL}/api/v1/auth/me`);
  expect(me.ok(), 'nach dem Login keine Sitzung').toBeTruthy();
}

/** Schreibende Anfrage an die API wie aus dem Browser (gleicher Origin, sonst lehnt die API ab) */
export async function apiPost<T>(page: Page, path: string, data: unknown): Promise<T> {
  const res = await page.request.post(`${BASE_URL}/api/v1${path}`, {
    data,
    headers: { origin: new URL(BASE_URL).origin },
  });
  expect(res.ok(), `POST ${path}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`${BASE_URL}/api/v1${path}`);
  expect(res.ok(), `GET ${path}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Neue Seite unter der Startseite von ENTW; liefert die Adresse im Frontend */
export async function createPage(page: Page, title: string): Promise<{ id: string; url: string }> {
  const space = await apiGet<{ homePageId: string }>(page, '/spaces/ENTW');
  const { id } = await apiPost<{ id: string }>(page, '/spaces/ENTW/pages', { parentId: space.homePageId, title });
  return { id, url: pagePath('ENTW', { id, title }) };
}

/** Seite in den Papierkorb, damit die Testdaten nicht im Baum stehen bleiben */
export async function trashPage(page: Page, id: string): Promise<void> {
  await page.request.delete(`${BASE_URL}/api/v1/pages/${id}`, { headers: { origin: new URL(BASE_URL).origin } });
}
