/** Small HTTP helpers for the admin API: JSON responses, bodies, errors. */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** An error with the status and JSON body the client gets. */
export class HttpError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(
    status: number,
    message: string,
    extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message = 'Not found.') => new HttpError(404, message);
export const conflict = (message: string, extra?: Record<string, unknown>) =>
  new HttpError(409, message, extra);

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    ...BASE_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function sendEmpty(res: ServerResponse, status = 204): void {
  res.writeHead(status, BASE_HEADERS);
  res.end();
}

export function sendError(res: ServerResponse, e: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (e instanceof HttpError)
    return sendJson(res, e.status, { error: e.message, ...e.extra });
  sendJson(res, 500, { error: (e as Error)?.message ?? String(e) });
}

/** The request body, refused with 413 past `limit` bytes. */
export function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((done, fail) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) {
      req.resume();
      fail(new HttpError(413, `The body is larger than ${limit} bytes.`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.removeAllListeners('data');
        req.resume();
        fail(new HttpError(413, `The body is larger than ${limit} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => done(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

/** A JSON object body. An empty body reads as `{}`. */
export async function readJson(
  req: IncomingMessage,
  limit = 2 * 1024 * 1024
): Promise<Record<string, unknown>> {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  let value: unknown;
  try {
    value = JSON.parse(buf.toString('utf8'));
  } catch {
    throw badRequest('The body is not valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw badRequest('The body must be a JSON object.');
  return value as Record<string, unknown>;
}

/** Throws 400 when `body` has keys outside `allowed`. */
export function onlyKeys(
  body: Record<string, unknown>,
  allowed: readonly string[]
): void {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length)
    throw badRequest(
      `Unknown key${extra.length > 1 ? 's' : ''}: ${extra.join(', ')}.`
    );
}
