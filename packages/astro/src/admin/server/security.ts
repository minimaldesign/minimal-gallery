/**
 * Who may reach the admin: only this machine, by a local host name, with the
 * per-process token. Paths that come from the client are checked before use.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { HttpError } from './http.ts';

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The host name of a `Host` header, without the port (`[::1]` keeps its brackets). */
export function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  return h.replace(/:\d*$/, '');
}

/**
 * 403 unless the request comes from a loopback address with a local `Host`
 * (no other machine, no DNS rebinding) and any `Origin` is that same host.
 */
export function checkLocal(req: IncomingMessage): void {
  const remote = req.socket.remoteAddress ?? '';
  if (!LOOPBACK.test(remote))
    throw new HttpError(403, 'The admin only answers this computer.');
  const host = req.headers.host ?? '';
  if (!LOCAL_HOSTS.has(hostName(host)))
    throw new HttpError(
      403,
      'Open the admin at localhost, 127.0.0.1 or [::1].'
    );
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Cross-origin requests are refused.');
    }
    if (originHost.toLowerCase() !== host.trim().toLowerCase())
      throw new HttpError(403, 'Cross-origin requests are refused.');
  }
}

/** 403 unless the token matches, from `x-mg-admin` or, for the event stream, `?token=`. */
export function checkToken(
  req: IncomingMessage,
  token: string,
  query: URLSearchParams,
  allowQuery: boolean
): void {
  const header = req.headers['x-mg-admin'];
  const given =
    (typeof header === 'string' ? header : undefined) ??
    (allowQuery ? (query.get('token') ?? undefined) : undefined);
  if (!given || !sameSecret(given, token))
    throw new HttpError(403, 'Missing or wrong admin token.');
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const PHOTO_ID = /^[a-z0-9_]+$/;
const ALBUM_ID = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/;

export function validPhotoId(id: string): boolean {
  return PHOTO_ID.test(id) && id.length <= 400;
}

export function validAlbumId(id: string): boolean {
  return ALBUM_ID.test(id) && id.length <= 400;
}

/**
 * A file name from the client: one path segment, no dotfile, no control
 * characters, at most 255 bytes.
 */
export function validFileName(name: string): boolean {
  return (
    name.length > 0 &&
    Buffer.byteLength(name) <= 255 &&
    !/[/\\\0]/.test(name) &&
    !/[\u0000-\u001f\u007f]/.test(name) &&
    !name.startsWith('.') &&
    name.trim() === name
  );
}

/** A storage key such as `colors__red_door/1a2b3c4d-grid.avif`. */
export function validMediaKey(key: string): boolean {
  return (
    /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/.test(key) &&
    !key.split('/').some((s) => s === '..' || s === '.' || s.startsWith('.'))
  );
}
