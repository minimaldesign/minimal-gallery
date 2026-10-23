/**
 * `checkBucket`: a round trip through the bucket with a probe object, for
 * `minimalgallery doctor --bucket`. It proves the credentials can write,
 * list, read and delete, and that `publicUrl` serves the bucket.
 */
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../config.ts';
import { PROBE_PREFIX } from './bucket.ts';
import {
  ACCESS_KEY_VAR,
  bucketCredentials,
  MISSING_CREDENTIALS,
  SECRET_KEY_VAR,
} from './env.ts';
import { s3Config } from './from-config.ts';
import { CACHE_CONTROL, s3Storage } from './s3.ts';
import type { BucketOptions } from './sync.ts';

export type BucketCheckStepName =
  'credentials' | 'put' | 'list' | 'has' | 'public' | 'remove';

export interface BucketCheckStep {
  step: BucketCheckStepName;
  ok: boolean;
  /** Milliseconds. */
  ms: number;
  message: string;
}

export interface BucketCheck {
  /** Every step passed. */
  ok: boolean;
  bucket: string;
  endpoint: string;
  publicUrl: string;
  /** Key of the probe object. */
  probe: string;
  steps: BucketCheckStep[];
  /** The public GET of the probe, or null when it did not run. */
  public: { url: string; status: number; cacheControl: string | null } | null;
}

/**
 * Put a probe object under `_minimalgallery-check/`, find it in a listing,
 * HEAD it, GET it through `publicUrl` (reporting the status and
 * `Cache-Control`), then delete it. Never throws for a failed step: each
 * step reports its own result. Throws a `BucketError` in repo mode.
 */
export async function checkBucket(
  galleryDir: string,
  options: BucketOptions = {}
): Promise<BucketCheck> {
  const config = options.config ?? (await loadConfig(galleryDir));
  const s = s3Config(config);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const publicUrl = s.publicUrl.replace(/\/+$/, '');
  const probe = `${PROBE_PREFIX}${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.txt`;
  const body = new TextEncoder().encode(
    `minimalgallery bucket check, ${new Date().toISOString()}\n`
  );
  const report: BucketCheck = {
    ok: false,
    bucket: s.bucket,
    endpoint: s.endpoint,
    publicUrl,
    probe,
    steps: [],
    public: null,
  };
  const step = async (
    name: BucketCheckStepName,
    fn: () => Promise<string>
  ): Promise<boolean> => {
    const t0 = performance.now();
    let ok = true;
    let message: string;
    try {
      message = await fn();
    } catch (e) {
      ok = false;
      message = (e as Error)?.message ?? String(e);
    }
    report.steps.push({
      step: name,
      ok,
      ms: Math.round(performance.now() - t0),
      message,
    });
    return ok;
  };

  const credentials = bucketCredentials(galleryDir, options.env);
  await step('credentials', async () => {
    if (!credentials) throw new Error(MISSING_CREDENTIALS);
    return `found ${ACCESS_KEY_VAR} and ${SECRET_KEY_VAR}`;
  });
  if (!credentials) return report;
  const bucket = s3Storage({
    ...s,
    ...credentials,
    fetch: options.fetch,
    retries: 1,
  });

  const put = await step('put', async () => {
    await bucket.put(probe, body, 'text/plain; charset=utf-8');
    return `wrote ${probe}`;
  });
  if (!put) return report;

  await step('list', async () => {
    const found = (await bucket.listObjects(PROBE_PREFIX)).some(
      (o) => o.key === probe
    );
    if (!found)
      throw new Error(
        `a listing of ${PROBE_PREFIX} does not include the probe just written`
      );
    return `found the probe in a listing of ${PROBE_PREFIX}`;
  });

  await step('has', async () => {
    const head = await bucket.head(probe);
    if (!head) throw new Error('HEAD of the probe just written gives 404');
    const cc = head.cacheControl;
    return cc === CACHE_CONTROL
      ? `HEAD gives Cache-Control “${cc}”`
      : `HEAD gives Cache-Control “${cc ?? 'none'}”, not “${CACHE_CONTROL}”: the bucket does not keep it`;
  });

  await step('public', async () => {
    const url = `${publicUrl}/${probe}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: 'follow' });
    } catch (e: any) {
      const cause = e?.cause?.code ?? e?.cause?.message ?? e?.message;
      throw new Error(
        `cannot reach ${url}${cause ? ` (${cause})` : ''}: check storage.publicUrl`
      );
    }
    const text = await res.text().catch(() => '');
    const cacheControl = res.headers.get('cache-control');
    report.public = { url, status: res.status, cacheControl };
    if (res.status === 404)
      throw new Error(
        `GET ${url} gives 404: storage.publicUrl does not serve bucket ${s.bucket}. Connect a custom domain (or the r2.dev URL) to the bucket and set storage.publicUrl to it.`
      );
    if (res.status === 401 || res.status === 403)
      throw new Error(
        `GET ${url} gives ${res.status}: bucket ${s.bucket} is not publicly readable at storage.publicUrl.`
      );
    if (!res.ok) throw new Error(`GET ${url} gives ${res.status}`);
    if (text !== new TextDecoder().decode(body))
      throw new Error(
        `GET ${url} gives 200 but not the probe: check that storage.publicUrl points at bucket ${s.bucket}`
      );
    return cacheControl?.includes('immutable')
      ? `GET ${url} gives 200, Cache-Control “${cacheControl}”`
      : `GET ${url} gives 200, but Cache-Control is “${cacheControl ?? 'none'}”: browsers will revalidate photos instead of caching them for a year`;
  });

  await step('remove', async () => {
    await bucket.remove(probe);
    return `deleted ${probe}`;
  });

  report.ok = report.steps.every((x) => x.ok);
  return report;
}

/** The check as plain text, for the CLI. */
export function formatBucketCheck(check: BucketCheck): string {
  const w = Math.max(...check.steps.map((x) => x.step.length), 6);
  const lines = [
    `${'bucket'.padEnd(w)}  ${check.bucket} at ${check.endpoint}, public at ${check.publicUrl}`,
    ...check.steps.map(
      (x) =>
        `${x.step.padEnd(w)}  ${x.ok ? 'ok    ' : 'failed'}  ${x.message} (${x.ms} ms)`
    ),
    '',
    check.ok ? 'The bucket works.' : 'The bucket check failed.',
  ];
  return lines.join('\n');
}
