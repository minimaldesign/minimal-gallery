/**
 * Media in dev. Bucket mode: `<base>_mg/<key>` is served from the stage
 * (`.minimalgallery/cache/media/<key>`), where the pipeline writes until a
 * publish uploads, and redirected to the bucket’s public URL otherwise.
 * Repo mode: served from `public/_mg` here rather than by Vite, whose list
 * of public files learns about a new derivative only after its watcher
 * does, so a thumbnail announced by a `photo` event would 404 for a moment.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
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

/** Send a file with a type from its extension. */
async function send(req: IncomingMessage, res: ServerResponse, file: string) {
  const s = await stat(file);
  res.writeHead(200, {
    'Content-Type':
      TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': s.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

/**
 * Serve one media key. `publicUrl` is the bucket’s address in bucket mode,
 * null in repo mode. Returns false to leave the request to Vite.
 */
export async function serveMedia(
  req: IncomingMessage,
  res: ServerResponse,
  galleryDir: string,
  key: string,
  publicUrl: string | null
): Promise<boolean> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (!validMediaKey(key)) return false;
  const parts = key.split('/');
  const inRepo = join(galleryDir, 'public', '_mg', ...parts);
  if (publicUrl === null) {
    if (!(await isFile(inRepo))) return false;
    await send(req, res, inRepo);
    return true;
  }
  const staged = join(galleryDir, STAGE_DIR, ...parts);
  if (await isFile(staged)) {
    await send(req, res, staged);
    return true;
  }
  // Originals kept in the repo (`originals: 'repo'`) are left to Vite.
  if (await isFile(inRepo)) return false;
  res.writeHead(302, {
    Location: `${publicUrl.replace(/\/+$/, '')}/${parts.map(encodeURIComponent).join('/')}`,
    'Cache-Control': 'no-store',
  });
  res.end();
  return true;
}
