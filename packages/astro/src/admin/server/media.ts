/**
 * Bucket mode in dev: `<base>_mg/<key>` is served from the stage
 * (`.minimalgallery/cache/media/<key>`), where the pipeline writes until a
 * publish uploads, and redirected to the bucket’s public URL otherwise.
 */
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { STAGE_DIR } from '@minimalgallery/pipeline/schema';
import { validMediaKey } from './security.ts';

const TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/** True when `file` exists and is a file. */
const isFile = (file: string) =>
  stat(file).then(
    (s) => s.isFile(),
    () => false
  );

/**
 * Serve one media key. Returns false when the request is not for the stage:
 * a file under `public/_mg` (originals kept in the repo) is left to Vite.
 */
export async function serveMedia(
  req: IncomingMessage,
  res: ServerResponse,
  galleryDir: string,
  key: string,
  publicUrl: string
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!validMediaKey(key)) return false;
  const parts = key.split('/');
  const staged = join(galleryDir, STAGE_DIR, ...parts);
  if (await isFile(staged)) {
    const s = await stat(staged);
    res.writeHead(200, {
      'Content-Type':
        TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': s.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(staged).pipe(res);
    return true;
  }
  if (await isFile(join(galleryDir, 'public', '_mg', ...parts))) return false;
  res.writeHead(302, {
    Location: `${publicUrl.replace(/\/+$/, '')}/${parts.map(encodeURIComponent).join('/')}`,
    'Cache-Control': 'no-store',
  });
  res.end();
  return true;
}

/**
 * Whether the S3 credentials are set: in the environment, or in the
 * gallery’s `.env` (the environment wins, as in the pipeline).
 */
export async function hasCredentials(
  galleryDir: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const keys = ['MG_S3_ACCESS_KEY_ID', 'MG_S3_SECRET_ACCESS_KEY'];
  const values: Record<string, string> = {};
  try {
    const text = await readFile(join(galleryDir, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch {}
  return keys.every((k) => !!(env[k] || values[k]));
}
