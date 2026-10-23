/**
 * An in-process S3 server for tests, on plain `node:http`. It speaks the
 * subset the pipeline uses (PUT, HEAD, GET, DELETE, ListObjectsV2 with
 * `max-keys` and continuation, error XML) and verifies every SigV4
 * signature the way S3 does: it rebuilds the canonical request from the raw
 * request line, so a key encoded wrongly fails with SignatureDoesNotMatch.
 */
import { createHash, createHmac } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockObject {
  body: Buffer;
  contentType: string | null;
  cacheControl: string | null;
  etag: string;
}

export interface MockRequest {
  method: string;
  key: string | null;
  query: Record<string, string>;
  status: number;
  signed: boolean;
}

export interface MockS3 {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Anonymous GETs under `${endpoint}/${bucket}/`, when `publicRead`. */
  publicUrl: string;
  objects: Map<string, MockObject>;
  requests: MockRequest[];
  publicRead: boolean;
  /** Largest page the server returns, whatever `max-keys` asks. */
  maxKeys: number;
  /** Fail the next `count` requests with a status, or by resetting the connection. */
  fail(count: number, how: number | 'reset'): void;
  close(): Promise<void>;
}

const sha256 = (data: string | Buffer) =>
  createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const ERROR_TEXT: Record<number, [string, string]> = {
  429: ['TooManyRequests', 'Too many requests.'],
  500: ['InternalError', 'We encountered an internal error. Please try again.'],
  503: ['SlowDown', 'Please reduce your request rate.'],
};

class Refusal {
  status: number;
  code: string;
  message: string;
  constructor(status: number, code: string, message: string) {
    this.status = status;
    this.code = code;
    this.message = message;
  }
}

function verifySignature(
  req: IncomingMessage,
  rawUrl: string,
  body: Buffer,
  creds: { accessKeyId: string; secretAccessKey: string; region: string }
): void {
  const auth = req.headers.authorization ?? '';
  const m =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/.exec(
      auth
    );
  if (!m)
    throw new Refusal(
      400,
      'AuthorizationHeaderMalformed',
      'The authorization header is malformed.'
    );
  const [, id, date, region, service, signedHeaders, signature] = m;
  if (id !== creds.accessKeyId)
    throw new Refusal(
      403,
      'InvalidAccessKeyId',
      'The Access Key Id you provided does not exist in our records.'
    );
  if (service !== 's3' || region !== creds.region)
    throw new Refusal(
      400,
      'AuthorizationHeaderMalformed',
      `The authorization header is malformed; the region '${region}' is wrong; expecting '${creds.region}'`
    );
  const amzDate = String(req.headers['x-amz-date'] ?? '');
  if (!amzDate.startsWith(date))
    throw new Refusal(403, 'AccessDenied', 'X-Amz-Date does not match.');
  const payloadHash = req.headers['x-amz-content-sha256'];
  if (typeof payloadHash !== 'string')
    throw new Refusal(
      400,
      'InvalidRequest',
      'Missing required header for this request: x-amz-content-sha256'
    );
  if (payloadHash !== 'UNSIGNED-PAYLOAD' && payloadHash !== sha256(body))
    throw new Refusal(
      400,
      'XAmzContentSHA256Mismatch',
      'The provided x-amz-content-sha256 header does not match what was computed.'
    );
  const headers = signedHeaders.split(';');
  for (const h of ['host', 'x-amz-date', 'x-amz-content-sha256'])
    if (!headers.includes(h))
      throw new Refusal(403, 'AccessDenied', `${h} must be signed.`);

  const [path, query = ''] = rawUrl.split('?');
  const canonicalUri = path
    .split('/')
    .map((seg) => encode(decodeURIComponent(seg)))
    .join('/');
  const canonicalQuery = query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const [k, v = ''] = pair.split('=');
      return [encode(decodeURIComponent(k)), encode(decodeURIComponent(v))];
    })
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalHeaders = headers
    .map(
      (h) =>
        `${h}:${String(req.headers[h] ?? '')
          .trim()
          .replace(/\s+/g, ' ')}\n`
    )
    .join('');
  const canonical = [
    req.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join(
    '\n'
  );
  let key = hmac(`AWS4${creds.secretAccessKey}`, date);
  key = hmac(key, region);
  key = hmac(key, service);
  key = hmac(key, 'aws4_request');
  const expected = createHmac('sha256', key).update(toSign).digest('hex');
  if (expected !== signature)
    throw new Refusal(
      403,
      'SignatureDoesNotMatch',
      'The request signature we calculated does not match the signature you provided. Check your key and signing method.'
    );
}

export async function startMockS3(
  options: {
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    region?: string;
    publicRead?: boolean;
    maxKeys?: number;
  } = {}
): Promise<MockS3> {
  const creds = {
    accessKeyId: options.accessKeyId ?? 'MOCKKEYID',
    secretAccessKey: options.secretAccessKey ?? 'mock-secret',
    region: options.region ?? 'auto',
  };
  const bucket = options.bucket ?? 'photos';
  const objects = new Map<string, MockObject>();
  const requests: MockRequest[] = [];
  const faults: Array<number | 'reset'> = [];

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const rawUrl = req.url ?? '/';
    const [path, queryString = ''] = rawUrl.split('?');
    const query = Object.fromEntries(
      queryString
        .split('&')
        .filter(Boolean)
        .map((p) => {
          const [k, v = ''] = p.split('=');
          return [decodeURIComponent(k), decodeURIComponent(v)];
        })
    );
    const segs = path.split('/').slice(1);
    const bucketName = decodeURIComponent(segs[0] ?? '');
    const key =
      segs.length > 1 && segs.slice(1).join('/')
        ? segs.slice(1).map(decodeURIComponent).join('/')
        : null;
    const method = req.method ?? 'GET';
    const signed = !!req.headers.authorization;
    const log = (status: number) =>
      requests.push({ method, key, query, status, signed });

    const send = (
      status: number,
      headers: Record<string, string | number> = {},
      text?: string | Buffer
    ) => {
      log(status);
      res.writeHead(status, headers);
      res.end(method === 'HEAD' ? undefined : text);
    };
    const refuse = (r: Refusal) =>
      send(
        r.status,
        { 'content-type': 'application/xml' },
        `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${r.code}</Code><Message>${esc(r.message)}</Message><RequestId>mock</RequestId></Error>`
      );

    const fault = faults.shift();
    if (fault === 'reset') {
      log(0);
      req.socket.destroy();
      return;
    }
    if (fault !== undefined) {
      const [code, message] = ERROR_TEXT[fault] ?? [
        `HTTP${fault}`,
        'Injected failure.',
      ];
      return refuse(new Refusal(fault, code, message));
    }

    try {
      if (signed) verifySignature(req, rawUrl, body, creds);
      else if (!(
        api.publicRead &&
        key &&
        (method === 'GET' || method === 'HEAD')
      ))
        throw new Refusal(403, 'AccessDenied', 'Access Denied');
      if (bucketName !== bucket)
        throw new Refusal(
          404,
          'NoSuchBucket',
          'The specified bucket does not exist'
        );
    } catch (e) {
      if (e instanceof Refusal) return refuse(e);
      throw e;
    }

    if (key === null) {
      if (method !== 'GET' || query['list-type'] !== '2')
        return refuse(
          new Refusal(501, 'NotImplemented', 'Not implemented by the mock.')
        );
      const prefix = query.prefix ?? '';
      const max = Math.min(Number(query['max-keys'] ?? 1000), api.maxKeys);
      const after = query['continuation-token']
        ? Buffer.from(query['continuation-token'], 'base64url').toString()
        : null;
      const all = [...objects.keys()]
        .filter((k) => k.startsWith(prefix) && (after === null || k > after))
        .sort();
      const page = all.slice(0, max);
      const truncated = all.length > page.length;
      const next = truncated
        ? Buffer.from(page[page.length - 1]).toString('base64url')
        : null;
      const contents = page
        .map((k) => {
          const o = objects.get(k)!;
          return `  <Contents>\n    <Key>${esc(k)}</Key>\n    <LastModified>2026-10-23T00:00:00.000Z</LastModified>\n    <ETag>&quot;${o.etag}&quot;</ETag>\n    <Size>${o.body.length}</Size>\n    <StorageClass>STANDARD</StorageClass>\n  </Contents>\n`;
        })
        .join('');
      return send(
        200,
        { 'content-type': 'application/xml' },
        `<?xml version="1.0" encoding="UTF-8"?>\n<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">\n  <Name>${bucket}</Name>\n  <Prefix>${esc(prefix)}</Prefix>\n  <KeyCount>${page.length}</KeyCount>\n  <MaxKeys>${max}</MaxKeys>\n  <IsTruncated>${truncated}</IsTruncated>\n${next ? `  <NextContinuationToken>${next}</NextContinuationToken>\n` : ''}${contents}</ListBucketResult>\n`
      );
    }

    if (method === 'PUT') {
      const etag = createHash('md5').update(body).digest('hex');
      objects.set(key, {
        body,
        contentType: req.headers['content-type'] ?? null,
        cacheControl: req.headers['cache-control'] ?? null,
        etag,
      });
      return send(200, { etag: `"${etag}"` });
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return send(204);
    }
    if (method === 'GET' || method === 'HEAD') {
      const o = objects.get(key);
      if (!o)
        return refuse(
          new Refusal(404, 'NoSuchKey', 'The specified key does not exist.')
        );
      return send(
        200,
        {
          'content-length': o.body.length,
          etag: `"${o.etag}"`,
          ...(o.contentType ? { 'content-type': o.contentType } : {}),
          ...(o.cacheControl ? { 'cache-control': o.cacheControl } : {}),
        },
        o.body
      );
    }
    return refuse(
      new Refusal(405, 'MethodNotAllowed', 'The method is not allowed.')
    );
  };

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}`;
  const api: MockS3 = {
    endpoint,
    bucket,
    ...creds,
    publicUrl: `${endpoint}/${bucket}`,
    objects,
    requests,
    publicRead: options.publicRead ?? true,
    maxKeys: options.maxKeys ?? 1000,
    fail(count, how) {
      for (let i = 0; i < count; i++) faults.push(how);
    },
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
  return api;
}
