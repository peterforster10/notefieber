/// <reference types="node" />
// End-to-End-Prüfungen der Oberfläche gegen die laufende lokale Umgebung (docs/LOCAL_SETUP.md,
// Abschnitt „Oberfläche messen“): Ladezeit einer Seite mit 200 Blöcken (E15) und Barrierefreiheit
// mit axe. Nicht in der CI, weil sie den ganzen Stack braucht (PostgreSQL, Zitadel, API,
// Collab-Server, Frontend), wie tree_load_test.sh.
//
//   pnpm --filter @notefieber/web e2e
//
// NF_E2E_URL: zu prüfendes Frontend (Standard http://localhost:3000). Für die Messung ein
// Produktions-Build, nicht next dev (das übersetzt beim ersten Aufruf und misst sich selbst).
// NF_E2E_LOGIN_URL: wo der Login beginnt (Standard NF_E2E_URL), siehe e2e/helpers.ts.
// NF_E2E_CHANNEL: installierter Browser statt des Chromiums von Playwright, z. B. msedge oder chrome.
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.NF_E2E_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL,
    locale: 'de-DE',
    trace: 'retain-on-failure',
    ...(process.env.NF_E2E_CHANNEL ? { channel: process.env.NF_E2E_CHANNEL } : {}),
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  outputDir: '../../.local/e2e-results',
});
