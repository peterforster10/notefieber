// Speicher für Dateien (Anhänge, Bilder): Garage, S3-kompatibel, nur im Cluster erreichbar
// (CLAUDE.md, Abschnitt 11). Der Browser spricht Garage nie direkt an, Hoch- und Herunterladen
// laufen über die API, die vorher die Rechte prüft (routes/files.ts). In der Datenbank steht nur
// der Eintrag in files mit storage_key. Für Tests ohne Garage: memoryStore().
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

export interface BlobStore {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** Inhalt als Stream; undefined, wenn es das Objekt nicht gibt */
  get(key: string): Promise<{ body: Readable; size?: number } | undefined>;
  delete(key: string): Promise<void>;
}

export interface S3Settings {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
}

export function s3Store(s: S3Settings): BlobStore {
  const client = new S3Client({
    endpoint: s.S3_ENDPOINT,
    region: s.S3_REGION,
    forcePathStyle: s.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: s.S3_ACCESS_KEY_ID, secretAccessKey: s.S3_SECRET_ACCESS_KEY },
  });
  const Bucket = s.S3_BUCKET;
  return {
    async put(key, bytes, mime) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: bytes, ContentType: mime }));
    },
    async get(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        if (!(r.Body instanceof Readable)) return undefined;
        return { body: r.Body, size: r.ContentLength };
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return undefined;
        throw err;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

/** Speicher im RAM, nur für Tests (CI hat kein Garage) */
export function memoryStore(): BlobStore & { keys(): string[] } {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      objects.set(key, Uint8Array.from(bytes));
    },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { body: Readable.from([Buffer.from(bytes)]), size: bytes.length } : undefined;
    },
    async delete(key) {
      objects.delete(key);
    },
    keys: () => [...objects.keys()],
  };
}
