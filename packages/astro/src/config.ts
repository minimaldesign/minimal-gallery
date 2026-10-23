/**
 * The gallery config as the theme reads it. `@minimalgallery/pipeline/config`
 * owns the config file (`minimalgallery.config.ts`) and its schema; this
 * module loads it, lets the integration options override it, and maps the
 * viewer defaults to the values of their theme tokens.
 */
import { readFileSync } from 'node:fs';
import {
  loadConfig,
  resolveConfig as resolvePipelineConfig,
  type GalleryConfig as PipelineConfig,
  type GalleryConfigInput,
} from '@minimalgallery/pipeline/config';

export type { GalleryConfigInput };

/** Theme options that `minimalgallery.config.ts` does not carry yet. */
export interface ThemeOptions {
  /**
   * The “Powered by minimal gallery” line at the end of the photos and the
   * version line in the keyboard shortcuts pane. On by default.
   */
  credit?: boolean;
}

/** Viewer defaults as token values (theme.mg.tokens.css). */
export interface ViewerDefaults {
  fit: 'cover' | 'contain';
  strip: 'on' | 'off';
  crop: 'square' | 'original';
  view: 'grid' | 'list';
  size: 'small' | 'medium' | 'large';
  backdrop: 'neutral' | 'photo' | 'light';
}

/** What the theme reads from `virtual:minimalgallery/config`. */
export interface GalleryConfig {
  title: string;
  description: string;
  author: string | null;
  /** The site's public URL from the config file, when it has one. */
  site: string | null;
  credit: boolean;
  /** This package's version, shown in the keyboard shortcuts pane. */
  version: string;
  defaults: ViewerDefaults;
}

/** Which token in theme.mg.tokens.css carries each viewer default. */
export const DEFAULT_TOKENS: Record<keyof ViewerDefaults, string> = {
  fit: '--mg-fit',
  strip: '--mg-strip',
  crop: '--mg-grid-crop',
  view: '--mg-grid-view',
  size: '--mg-grid-size',
  backdrop: '--mg-backdrop',
};

const SIZES = { 1: 'small', 2: 'medium', 3: 'large' } as const;

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { version: string };

export function themeConfig(
  c: PipelineConfig & ThemeOptions,
  options: ThemeOptions = {}
): GalleryConfig {
  const d = c.defaults;
  return {
    title: c.name,
    description: c.description ?? `Photographs in ${c.name}.`,
    author: c.author ?? null,
    site: c.site ?? null,
    // the config file's own key once the pipeline's schema has it
    credit: options.credit ?? c.credit ?? true,
    version,
    defaults: {
      fit: d.fit === 'fit' ? 'contain' : 'cover',
      strip: d.strip ? 'on' : 'off',
      crop: d.crop,
      view: d.view,
      size: SIZES[d.size],
      backdrop: d.backdrop,
    },
  };
}

/**
 * Writes the configured defaults into the token contract as the
 * `initial-value` of each `@property`, so the contract file stays the one
 * place a default lives and an owner override in custom.css still wins.
 */
export function applyDefaultsToTokens(
  css: string,
  defaults: ViewerDefaults
): string {
  let out = css;
  for (const [key, token] of Object.entries(DEFAULT_TOKENS)) {
    const rule = new RegExp(
      `(@property ${token} \\{[^}]*?initial-value:\\s*)[^;]+;`
    );
    if (!rule.test(out))
      throw new Error(`theme.mg.tokens.css has no @property ${token}`);
    out = out.replace(rule, `$1${defaults[key as keyof ViewerDefaults]};`);
  }
  return out;
}

/** The gallery's config file, with the integration options on top. */
export async function resolveConfig(
  galleryDir: string,
  overrides: GalleryConfigInput & ThemeOptions = {}
): Promise<GalleryConfig> {
  const file = await loadConfig(galleryDir);
  const { credit, ...rest } = overrides;
  const merged = resolvePipelineConfig(
    {
      ...file,
      ...rest,
      defaults: { ...file.defaults, ...rest.defaults },
    },
    'minimalgallery integration options'
  );
  return themeConfig(merged, { credit });
}
