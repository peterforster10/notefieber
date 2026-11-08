// Next.js ist nur die Oberfläche: keine Geschäftslogik in Server Actions oder Route
// Handlern, alle Daten kommen über die API (CLAUDE.md, Abschnitt 3).
import path from 'node:path';
import type { NextConfig } from 'next';

const root = path.join(import.meta.dirname, '../..');

// Lokal: Einstellungen aus der .env im Wurzelordner (dieselbe Datei wie für die API).
// Next.js liest sonst nur .env-Dateien in apps/web. Gesetzte Variablen bleiben, wie sie sind.
try {
  process.loadEnvFile(path.join(root, '.env'));
} catch {
  // keine .env: Standardwerte
}

const apiInternalUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Eigener Container (K3s): .next/standalone enthält Server und nötige Pakete. Wurzel für
  // die Suche nach Dateien ist das Monorepo, damit packages/shared mitkommt.
  output: 'standalone',
  outputFileTracingRoot: root,
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@notefieber/shared'],
  // Frontend und API unter einer Adresse, wie später der Ingress (/ → web, /api → api).
  // So gilt das Sitzungs-Cookie für beide, und der Browser braucht kein CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
