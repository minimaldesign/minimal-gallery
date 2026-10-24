/**
 * S3-compatible storage (Cloudflare R2, Backblaze B2, MinIO, AWS S3), signed
 * with SigV4 by `aws4fetch`. URLs are path-style:
 * `${endpoint}/${bucket}/${key}`.
 */
import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { XMLParser } from 'fast-xml-parser';
import { ACCESS_KEY_VAR, SECRET_KEY_VAR } from './env.ts';
import type { Storage } from './types.ts';

/** Sent with every upload. Keys are content-addressed, so a URL never changes meaning. */
export const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface S3StorageOptions {
  /** API endpoint, for example `https://<account id>.r2.cloudflarestorage.com`. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Signing region. Default `auto`, which R2 expects. */
  region?: string;
  /** Public base URL (custom domain) that serves the bucket. */
  publicUrl: string;
  /** Default: the global `fetch`. Tests pass their own. */
  fetch?: typeof fetch;
  /** Retries after a network error, a 429 or a 5xx. Default 4. */
  retries?: number;
  /** First retry delay in milliseconds, doubled each time. Default 250. */
  retryDelay?: number;
  /** Keys per ListObjectsV2 page, 1 to 1000. Default 1000. */
  pageSize?: number;
}

/** One object in a bucket listing. */
export interface S3Object {
  key: string;
  size: number;
  /** Without quotes. The MD5 of the content for a single-part upload. */
  etag: string;
}

export interface S3Head {
  size: number;
  etag: string;
  contentType: string | null;
  cacheControl: string | null;
}

/**
 * `Storage` on a bucket, plus the calls the sync and check functions need.
 * `has` and `list` answer from one listing of the whole bucket, loaded on
 * first use and kept current by `put` and `remove`.
 */
export interface S3Storage extends Storage {
  readonly bucket: string;
  readonly endpoint: string;
  /** The cached listing, keyed by object key. */
  index(): Promise<ReadonlyMap<string, S3Object>>;
  /** Forget the cached listing; the next call lists the bucket again. */
  refresh(): void;
  /** List objects under a prefix, every page, without the cache. */
  listObjects(prefix?: string): Promise<S3Object[]>;
  /** HEAD one object, without the cache. Null when it does not exist. */
  head(key: string): Promise<S3Head | null>;
}

/** A request to the bucket failed. The message is meant to be shown as is. */
export class S3Error extends Error {
  /** HTTP status, or 0 when the endpoint could not be reached. */
  status: number;
  /** The S3 error code (`AccessDenied`, `NoSuchBucket`), `NetworkError`, or `HTTP <status>`. */
  code: string;
  /** What was attempted, such as `PUT <key>` or `LIST`. */
  operation: string;
  /** True when the credentials are wrong or lack a permission (401, 403). */
  credentials: boolean;

  constructor(
    message: string,
    fields: {
      status: number;
      code: string;
      operation: string;
      credentials?: boolean;
    },
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'S3Error';
    this.status = fields.status;
    this.code = fields.code;
    this.operation = fields.operation;
    this.credentials = fields.credentials ?? false;
  }
}

const CREDENTIAL_CODES = new Set([
  'AccessDenied',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'InvalidToken',
  'ExpiredToken',
  'Unauthorized',
]);

const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  // Keys may start or end with spaces.
  trimValues: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'Contents',
});

/** RFC 3986 encoding of one path segment or query value, as SigV4 wants it. */
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export const md5 = (bytes: Uint8Array) =>
  createHash('md5').update(bytes).digest('hex');
const unquote = (etag: string | null | undefined) =>
  (etag ?? '').replace(/^W\//, '').replace(/^"|"$/g, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const EMPTY = new Uint8Array(0);

async function drain(res: Response): Promise<void> {
  try {
    await res.arrayBuffer();
  } catch {}
}

/** S3-compatible storage. See `S3Storage`. */
export function s3Storage(options: S3StorageOptions): S3Storage {
  const {
    bucket,
    accessKeyId,
    secretAccessKey,
    region = 'auto',
    retries = 4,
    retryDelay = 250,
  } = options;
  const pageSize = Math.min(1000, Math.max(1, options.pageSize ?? 1000));
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const publicUrl = options.publicUrl.replace(/\/+$/, '');
  const bucketUrl = `${endpoint}/${encode(bucket)}`;
  const objectUrl = (key: string) =>
    `${bucketUrl}/${key.split('/').map(encode).join('/')}`;
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region,
    retries: 0,
  });

  const retryWait = (attempt: number, retryAfter: string | null) => {
    const seconds = Number(retryAfter);
    if (retryAfter && Number.isFinite(seconds) && seconds >= 0)
      return Math.min(seconds, 20) * 1000;
    return retryDelay * 2 ** attempt * (0.75 + Math.random() / 2);
  };

  const failure = async (
    operation: string,
    res: Response,
    method: string
  ): Promise<S3Error> => {
    let code = `HTTP ${res.status}`;
    let message = res.statusText;
    if (method !== 'HEAD') {
      const text = await res.text().catch(() => '');
      try {
        const err = xml.parse(text)?.Error;
        if (err?.Code) code = String(err.Code).trim();
        if (err?.Message) message = String(err.Message).trim();
      } catch {}
    }
    const credentials =
      res.status === 401 || res.status === 403 || CREDENTIAL_CODES.has(code);
    let hint = '';
    if (credentials)
      hint = ` Check ${ACCESS_KEY_VAR} and ${SECRET_KEY_VAR} (in the environment or the gallery’s .env file), and that they can read and write bucket ${bucket}.`;
    else if (code === 'NoSuchBucket' || (res.status === 404 && !message))
      hint = ` Check storage.bucket and storage.endpoint in minimalgallery.config.ts.`;
    else if (code === 'AuthorizationHeaderMalformed')
      hint = ` Check storage.region in minimalgallery.config.ts.`;
    const text = message ? `${message.replace(/\.$/, '')}.` : '';
    return new S3Error(
      `S3 ${operation} (bucket ${bucket}) failed: ${res.status} ${code}${text ? `: ${text}` : '.'}${hint}`,
      { status: res.status, code, operation, credentials }
    );
  };

  /** A signed request, retried on network errors, 429 and 5xx. */
  const request = async (
    operation: string,
    method: string,
    url: string,
    init: {
      headers?: Record<string, string>;
      body?: Uint8Array;
      /** Statuses that are not errors besides 2xx, such as 404 for DELETE. */
      ok?: number[];
    } = {}
  ): Promise<Response> => {
    const body = init.body;
    const headers = {
      ...init.headers,
      'x-amz-content-sha256': sha256(body ?? EMPTY),
    };
    for (let attempt = 0; ; attempt++) {
      const signed = await client.sign(url, {
        method,
        headers,
        ...(body ? { body: body as RequestInit['body'] } : {}),
      });
      let res: Response;
      try {
        res = await fetchImpl(signed);
      } catch (e: any) {
        if (attempt < retries) {
          await sleep(retryWait(attempt, null));
          continue;
        }
        const cause = e?.cause?.code ?? e?.cause?.message ?? e?.message;
        throw new S3Error(
          `S3 ${operation} (bucket ${bucket}) failed: cannot reach ${endpoint}${cause ? ` (${cause})` : ''} after ${attempt + 1} attempt(s). Check storage.endpoint and the network connection.`,
          { status: 0, code: 'NetworkError', operation },
          { cause: e }
        );
      }
      if (res.ok || init.ok?.includes(res.status)) return res;
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await drain(res);
        await sleep(retryWait(attempt, res.headers.get('retry-after')));
        continue;
      }
      throw await failure(operation, res, method);
    }
  };

  const listObjects = async (prefix = ''): Promise<S3Object[]> => {
    const out: S3Object[] = [];
    const seen = new Set<string>();
    let token: string | undefined;
    do {
      const query: Array<[string, string]> = [
        ['list-type', '2'],
        ['max-keys', String(pageSize)],
      ];
      if (prefix) query.push(['prefix', prefix]);
      if (token) query.push(['continuation-token', token]);
      const qs = query.map(([k, v]) => `${k}=${encode(v)}`).join('&');
      const operation = prefix ? `LIST ${prefix}` : 'LIST';
      const res = await request(operation, 'GET', `${bucketUrl}?${qs}`);
      const text = await res.text();
      let result: any;
      try {
        result = xml.parse(text)?.ListBucketResult;
      } catch {}
      if (!result)
        throw new S3Error(
          `S3 ${operation} (bucket ${bucket}) failed: the response is not a ListObjectsV2 result. Check storage.endpoint.`,
          { status: res.status, code: 'InvalidResponse', operation }
        );
      for (const c of result.Contents ?? [])
        out.push({
          key: String(c.Key ?? ''),
          size: Number(c.Size ?? 0),
          etag: unquote(String(c.ETag ?? '')),
        });
      const truncated = String(result.IsTruncated ?? '').trim() === 'true';
      token = truncated
        ? String(result.NextContinuationToken ?? '').trim() || undefined
        : undefined;
      if (token && seen.has(token))
        throw new S3Error(
          `S3 ${operation} (bucket ${bucket}) failed: the listing repeats a continuation token.`,
          { status: res.status, code: 'InvalidResponse', operation }
        );
      if (token) seen.add(token);
    } while (token);
    return out;
  };

  let index: Promise<Map<string, S3Object>> | undefined;
  const loadIndex = () =>
    (index ??= listObjects().then(
      (objects) => new Map(objects.map((o) => [o.key, o]))
    ));
  /** Apply a change to the listing once it is loaded; never starts one. */
  const update = (fn: (m: Map<string, S3Object>) => void) => {
    index?.then(fn, () => {});
  };

  return {
    bucket,
    endpoint,
    async put(key, bytes, contentType) {
      const res = await request(`PUT ${key}`, 'PUT', objectUrl(key), {
        body: bytes,
        headers: {
          'content-type': contentType,
          'cache-control': CACHE_CONTROL,
        },
      });
      await drain(res);
      const etag = unquote(res.headers.get('etag')) || md5(bytes);
      update((m) => m.set(key, { key, size: bytes.byteLength, etag }));
    },
    async has(key) {
      return (await loadIndex()).has(key);
    },
    url(key) {
      return `${publicUrl}/${key}`;
    },
    async list(prefix) {
      const keys: string[] = [];
      for (const key of (await loadIndex()).keys())
        if (key.startsWith(prefix)) keys.push(key);
      return keys.sort();
    },
    async remove(key) {
      const res = await request(`DELETE ${key}`, 'DELETE', objectUrl(key), {
        ok: [404],
      });
      await drain(res);
      update((m) => m.delete(key));
    },
    index: loadIndex,
    refresh() {
      index = undefined;
    },
    listObjects,
    async head(key) {
      const res = await request(`HEAD ${key}`, 'HEAD', objectUrl(key), {
        ok: [404],
      });
      await drain(res);
      if (res.status === 404) return null;
      return {
        size: Number(res.headers.get('content-length') ?? 0),
        etag: unquote(res.headers.get('etag')),
        contentType: res.headers.get('content-type'),
        cacheControl: res.headers.get('cache-control'),
      };
    },
  };
}
