/**
 * `minimalgallery.config.ts`: the site’s settings, read by the pipeline
 * (ladder, storage, originals, colour) and by the Astro side (name, site,
 * viewer defaults, album sort).
 *
 * ```ts
 * import { defineConfig } from '@minimalgallery/pipeline/config';
 * export default defineConfig({ name: 'Yann’s photos', site: 'https://example.com' });
 * ```
 */
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { defaultLadder, type LadderConfig } from './ladder.ts';
import { AlbumSort, VariantFormat } from './schema.ts';

export {
  ACCOUNT_ID_PLACEHOLDER,
  PUBLIC_URL_PLACEHOLDER,
  configPlaceholders,
  placeholderMessage,
  type ConfigPlaceholder,
} from './placeholders.ts';

export const LadderVariantConfig = z.object({
  /** Used in derivative file names; lowercase letters, digits and `-`. */
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, {
    message: 'use lowercase letters, digits and -',
  }),
  /** Long edge in pixels. */
  longEdge: z.number().int().min(16).max(16384),
  format: VariantFormat,
  quality: z.number().int().min(1).max(100),
  /** Chroma subsampling for AVIF and JPEG. Lossy WebP is always 4:2:0. */
  chroma: z.enum(['4:2:0', '4:4:4']).default('4:2:0'),
  /** Write this variant even when the source is smaller (at source size). */
  always: z.boolean().default(false),
});
export type LadderVariantConfig = z.infer<typeof LadderVariantConfig>;

const defaultVariants: z.input<typeof LadderVariantConfig>[] =
  defaultLadder.variants.map((v) => ({
    name: v.name,
    longEdge: v.longEdge,
    format: v.format,
    quality: v.quality,
    chroma: v.chroma ?? '4:2:0',
    always: v.always ?? false,
  }));

export const StorageConfig = z.discriminatedUnion('mode', [
  /** Derivatives in `public/_mg`, committed and deployed with the site. */
  z.object({ mode: z.literal('site') }),
  /**
   * An S3-compatible bucket (Cloudflare R2, Backblaze B2, AWS S3). Credentials
   * are never in the config: they come from `MG_S3_ACCESS_KEY_ID` and
   * `MG_S3_SECRET_ACCESS_KEY`.
   */
  z.object({
    mode: z.literal('s3'),
    bucket: z.string().min(1),
    endpoint: z.url(),
    region: z.string().min(1).default('auto'),
    /** Public base URL that serves the bucket, usually a custom domain. */
    publicUrl: z.url(),
  }),
]);
export type StorageConfig = z.infer<typeof StorageConfig>;

/** Starting values of the viewer’s settings; visitors can change them. */
export const ViewerDefaults = z.object({
  /** `fill` covers the window and crops the edges; `fit` shows the whole photo. */
  fit: z.enum(['fill', 'fit']).default('fill'),
  /** Show the filmstrip under the viewer. */
  strip: z.boolean().default(false),
  /** Grid thumbnails as squares or in each photo’s own shape. */
  crop: z.enum(['square', 'original']).default('square'),
  view: z.enum(['grid', 'list']).default('grid'),
  /** Thumbnail size step: 1 small, 2 medium, 3 large. */
  size: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** `neutral` background colour, `photo` tinted by each photo, `light` pale grey. */
  backdrop: z.enum(['neutral', 'photo', 'light']).default('neutral'),
});
export type ViewerDefaults = z.infer<typeof ViewerDefaults>;

export const GalleryConfigSchema = z
  .object({
    name: z.string().min(1).default('Photos'),
    author: z.string().optional(),
    description: z.string().optional(),
    /** Public URL of the site, used for canonical links, the feed and og:image. */
    site: z.url().optional(),
    /** The “Powered by minimal gallery” line and the version in the keys pane. */
    credit: z.boolean().default(true),
    /** An SVG file shown before the name in the header, relative to the gallery directory. */
    logo: z
      .string()
      .regex(/\.svg$/i, { message: 'use an .svg file' })
      .optional(),
    storage: StorageConfig.default({ mode: 'site' }),
    ladder: z
      .array(LadderVariantConfig)
      .min(1)
      .refine((v) => new Set(v.map((x) => x.name)).size === v.length, {
        message: 'variant names must be unique',
      })
      .prefault(defaultVariants),
    /**
     * Whether the original files are published. `none` (default) keeps them
     * private; `site` copies them to `public/_mg`; `bucket` uploads them to
     * the s3 storage.
     */
    originals: z.enum(['none', 'bucket', 'site']).default('none'),
    /**
     * Where the admin saves a photo’s metadata edits. `sidecar` (default)
     * writes `<file>.xmp` next to the photo and never changes the photo;
     * `photo` writes them into the photo file itself.
     */
    saveEdits: z.enum(['sidecar', 'photo']).default('sidecar'),
    /** Colour space of the derivatives. `p3` keeps wide-gamut colour. */
    color: z.enum(['srgb', 'p3']).default('srgb'),
    defaults: ViewerDefaults.prefault({}),
    albums: z
      .object({
        /** Sort for albums whose `_album.md` does not set one. */
        sort: AlbumSort.default('date'),
      })
      .prefault({}),
  })
  .refine((c) => c.originals !== 'bucket' || c.storage.mode === 's3', {
    message: "originals: 'bucket' needs storage: { mode: 's3', ... }",
    path: ['originals'],
  });

/** The resolved config, every default filled in. */
export type GalleryConfig = z.output<typeof GalleryConfigSchema>;
/** What a person writes in `minimalgallery.config.ts`: every key optional. */
export type GalleryConfigInput = z.input<typeof GalleryConfigSchema>;

/** Typed identity function for `minimalgallery.config.ts`. */
export function defineConfig(config: GalleryConfigInput): GalleryConfigInput {
  return config;
}

/** Validate a config object and fill in defaults. Throws a readable error. */
export function resolveConfig(
  input: unknown,
  source = 'minimalgallery config'
): GalleryConfig {
  const parsed = GalleryConfigSchema.safeParse(input ?? {});
  if (!parsed.success)
    throw new Error(`${source}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Every default, as used when a gallery has no config file. */
export const defaultConfig: GalleryConfig = resolveConfig({});

export const CONFIG_FILES = [
  'minimalgallery.config.ts',
  'minimalgallery.config.mts',
  'minimalgallery.config.js',
  'minimalgallery.config.mjs',
] as const;

/** Path of the gallery’s config file, or null when there is none. */
export async function findConfigFile(dir: string): Promise<string | null> {
  for (const name of CONFIG_FILES) {
    const path = join(dir, name);
    try {
      await access(path);
      return path;
    } catch {}
  }
  return null;
}

/**
 * Load `minimalgallery.config.{ts,mts,js,mjs}` from a gallery directory and
 * resolve it. Falls back to `defaultConfig` when there is no file.
 *
 * A dev server may call this again after an edit, so nothing is cached:
 * TypeScript is compiled by jiti with its caches off, and JavaScript is
 * imported natively under a URL that changes with the file’s mtime (Node
 * caches ES modules by URL for the life of the process).
 */
export async function loadConfig(dir: string): Promise<GalleryConfig> {
  const path = await findConfigFile(dir);
  if (!path) return defaultConfig;
  let mod: unknown;
  try {
    if (/\.m?js$/.test(path)) {
      const url = pathToFileURL(path);
      url.searchParams.set('mtime', String((await stat(path)).mtimeMs));
      const ns = (await import(url.href)) as { default?: unknown };
      mod = ns.default;
    } else {
      const { createJiti } = await import('jiti');
      const jiti = createJiti(import.meta.url, {
        moduleCache: false,
        fsCache: false,
        interopDefault: true,
      });
      mod = await jiti.import(path, { default: true });
    }
  } catch (e) {
    throw new Error(`${path}: cannot load: ${(e as Error).message}`);
  }
  return resolveConfig(mod, path);
}

/** The pipeline’s ladder from the config. */
export function ladderFromConfig(config: GalleryConfig): LadderConfig {
  return {
    variants: config.ladder.map((v) => ({
      name: v.name,
      longEdge: v.longEdge,
      format: v.format,
      quality: v.quality,
      chroma: v.chroma,
      ...(v.always ? { always: true } : {}),
    })),
    avifEffort: defaultLadder.avifEffort,
    placeholderWidth: defaultLadder.placeholderWidth,
  };
}
