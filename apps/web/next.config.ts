// Next.js ist nur die Oberfläche: keine Geschäftslogik in Server Actions oder Route
// Handlern, alle Daten kommen über die API (CLAUDE.md, Abschnitt 3).
import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Eigener Container (K3s): .next/standalone enthält Server und nötige Pakete. Wurzel für
  // die Suche nach Dateien ist das Monorepo, damit packages/shared mitkommt.
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@notefieber/shared'],
};

export default nextConfig;
