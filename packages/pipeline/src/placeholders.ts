/**
 * Stand-in values that create-minimalgallery writes to
 * `minimalgallery.config.ts` in bucket mode while the owner does not know
 * the real ones yet. Publish, sync and `doctor --bucket` refuse to reach
 * the bucket while the config still holds one.
 */

/** In the R2 `endpoint` while the Cloudflare account id is not known. */
export const ACCOUNT_ID_PLACEHOLDER = 'your-account-id';
/** The `publicUrl` while the bucket has no custom domain. */
export const PUBLIC_URL_PLACEHOLDER = 'https://media.example.com';

export interface ConfigPlaceholder {
  /** The config key that holds the stand-in. */
  key: 'storage.endpoint' | 'storage.publicUrl';
  /** What to put there instead, as a sentence. */
  fix: string;
}

const hostname = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/** The stand-ins the storage config still holds, in config order. Empty in site mode. */
export function configPlaceholders(config: {
  storage: { mode: string; endpoint?: string; publicUrl?: string };
}): ConfigPlaceholder[] {
  const s = config.storage;
  if (s.mode !== 's3') return [];
  const found: ConfigPlaceholder[] = [];
  if (
    hostname(s.endpoint ?? '')
      .split('.')
      .includes(ACCOUNT_ID_PLACEHOLDER)
  )
    found.push({
      key: 'storage.endpoint',
      fix: `replace ${ACCOUNT_ID_PLACEHOLDER} with your Cloudflare account id, which npx wrangler whoami prints.`,
    });
  if (hostname(s.publicUrl ?? '') === hostname(PUBLIC_URL_PLACEHOLDER))
    found.push({
      key: 'storage.publicUrl',
      fix: `replace ${PUBLIC_URL_PLACEHOLDER} with the address of the custom domain connected to the bucket (in the Cloudflare dashboard: R2, the bucket, Settings, Custom Domains).`,
    });
  return found;
}

/** The stand-ins as a message: a first line, then one line per key. */
export function placeholderMessage(found: ConfigPlaceholder[]): string {
  return [
    `minimalgallery.config.ts still holds ${found.length === 1 ? 'a stand-in value' : 'stand-in values'} from the setup:`,
    ...found.map((p) => `  ${p.key}: ${p.fix}`),
  ].join('\n');
}
