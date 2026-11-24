// Next.js ist nur die Oberfläche: keine Geschäftslogik in Server Actions oder Route
// Handlern, alle Daten kommen über die API (CLAUDE.md, Abschnitt 3).
import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const root = path.join(import.meta.dirname, '../..');

// Lokal: Einstellungen aus der .env im Wurzelordner (dieselbe Datei wie für die API).
// Next.js liest sonst nur .env-Dateien in apps/web. Gesetzte Variablen bleiben, wie sie sind.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // keine .env: Standardwerte
}

const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// Collab-Server: im Cluster unter derselben Adresse (/collab, der Browser rechnet sie zur Laufzeit
// aus, siehe components/page-editor.tsx). Lokal läuft er auf eigenem Port; ohne Angabe nimmt
// next dev deshalb ws://localhost:<COLLAB_PORT>. Eine Next.js-Weiterleitung reicht WebSockets
// nicht zuverlässig durch. NEXT_PUBLIC_-Werte stehen nach dem Build fest im Bundle.
const collabUrl =
  process.env.NEXT_PUBLIC_COLLAB_URL ??
  (process.env.NODE_ENV === 'development' ? `ws://localhost:${process.env.COLLAB_PORT ?? '1234'}` : undefined);

const nextConfig: NextConfig = {
  // Eigener Container (K3s): .next/standalone enthält Server und nötige Pakete. Wurzel für
  // die Suche nach Dateien ist das Monorepo, damit packages/shared mitkommt.
  output: 'standalone',
  outputFileTracingRoot: root,
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@notefieber/shared', '@notefieber/editor-schema'],
  env: collabUrl ? { NEXT_PUBLIC_COLLAB_URL: collabUrl } : {},
  // Frontend und API unter einer Adresse, wie später der Ingress (/ → web, /api → api).
  // So gilt das Sitzungs-Cookie für beide, und der Browser braucht kein CORS.
  // Bilder nur von der eigenen Adresse (hochgeladen über /api/v1/files) und aus dem Browser selbst
  // (data:, blob: beim Einfügen): Fremde Bild-Adressen lädt der Browser nicht, so gehen keine
  // IP-Adressen der Lesenden an fremde Server (M2, E07). Weitere Regeln der CSP folgen mit E21.
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'Content-Security-Policy', value: "img-src 'self' data: blob:" }] }];
  },
  // Kurze Adressen seit 24. November 2026 (/s/entw/p/<titel>-<id>, packages/shared/src/urls.ts):
  // Die früheren Adressen bleiben gültig, Lesezeichen und geteilte Links führen dauerhaft dorthin
  async redirects() {
    return [
      { source: '/spaces/:key', destination: '/s/:key', permanent: true },
      { source: '/spaces/:key/settings', destination: '/s/:key/settings', permanent: true },
      { source: '/spaces/:key/pages/:slug', destination: '/s/:key/p/:slug', permanent: true },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

// Texte in Deutsch und Englisch (E15): Sprache und Nachrichten pro Anfrage aus src/i18n/request.ts
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl(nextConfig);
