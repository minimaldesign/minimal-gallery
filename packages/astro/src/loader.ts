import type { Loader, LoaderContext } from 'astro/loaders';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  ALBUMS_FILE,
  AlbumsFile,
  MANIFEST_DIR,
  PhotoManifest,
} from '@minimalgallery/pipeline/schema';
import {
  adaptPhoto,
  ADAPTER_VERSION,
  type PhotoRecord,
} from './data/adapter.ts';
import { getSharedOptions } from './options.ts';

export interface GalleryLoaderOptions {
  /** Overrides the integration’s `galleryDir`. */
  galleryDir?: string;
}

/**
 * Entry schemas for the store. Manifests are validated against the
 * pipeline's own schema when read; these only check the adapted record.
 */
export const PhotoEntry = z.looseObject({
  id: z.string(),
  album: z.string(),
  slug: z.string(),
  title: z.string(),
  width: z.number(),
  height: z.number(),
  url: z.string(),
  albumUrl: z.string(),
  captionHtml: z.string().nullable(),
  digest: z.string(),
});
export const AlbumEntry = z.looseObject({
  id: z.string(),
  title: z.string(),
  photoIds: z.array(z.string()),
  hidden: z.boolean().default(false),
  url: z.string(),
  digest: z.string(),
});

export interface PhotoEntryData extends PhotoRecord {
  url: string;
  albumUrl: string;
  captionHtml: string | null;
}
export interface AlbumEntryData {
  id: string;
  path?: string;
  parent?: string | null;
  title: string;
  description?: string | null;
  descriptionHtml: string | null;
  cover?: string | null;
  photoIds: string[];
  children?: string[];
  hidden: boolean;
  url: string;
  digest: string;
}

/** Page URL of an album: its id, which already uses `/` between nested folders. */
export const albumUrl = (albumId: string) => `/${albumId}/`;
/** Page URL of a photo inside its album. */
export const photoUrl = (albumId: string, slug: string) =>
  `/${albumId}/${slug}/`;

function galleryDirOf(ctx: LoaderContext, options: GalleryLoaderOptions) {
  const root = fileURLToPath(ctx.config.root);
  return resolve(
    root,
    options.galleryDir ?? getSharedOptions().galleryDir ?? '.'
  );
}

/**
 * In dev, bucket-mode media URLs point at the bucket, where nothing may be
 * uploaded yet: they become `<base>_mg/<key>`, which the dev server serves
 * from the stage. The digest gets a `.dev` suffix so that a later
 * `astro build` never reuses these entries from the data store.
 */
function localMedia(m: PhotoManifest, mediaBase: string): PhotoManifest {
  const remote = (url?: string) => !!url && /^https?:\/\//.test(url);
  if (!m.variants.some((v) => remote(v.url)) && !remote(m.original.url))
    return m;
  const local = (url: string, key: string) =>
    remote(url) ? `${mediaBase}${key}` : url;
  return {
    ...m,
    variants: m.variants.map((v) => ({ ...v, url: local(v.url, v.key) })),
    original:
      m.original.url && m.original.key
        ? { ...m.original, url: local(m.original.url, m.original.key) }
        : m.original,
    digest: `${m.digest}.dev`,
  };
}

async function readManifests(dir: string, mediaBase?: string) {
  const manifestDir = join(dir, MANIFEST_DIR);
  let files: string[];
  try {
    files = await readdir(manifestDir);
  } catch {
    throw new Error(
      `No manifests in ${manifestDir}. Run \`mg-pipeline ${dir}\` first.`
    );
  }
  const read = async (f: string) =>
    JSON.parse(await readFile(join(manifestDir, f), 'utf8'));
  const albums = AlbumsFile.parse(await read(ALBUMS_FILE)).albums;
  const photos = await Promise.all(
    files
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map(async (f) => {
        const parsed = PhotoManifest.safeParse(await read(f));
        if (!parsed.success)
          throw new Error(
            `${join(manifestDir, f)} does not match this pipeline version; run \`mg-pipeline\` again.\n${parsed.error.message}`
          );
        return adaptPhoto(
          mediaBase ? localMedia(parsed.data, mediaBase) : parsed.data
        );
      })
  );
  return { albums, photos };
}

/**
 * Content Layer loader for the manifests written by `@minimalgallery/pipeline`.
 * Use it once per collection:
 *
 *   photos: defineCollection({ loader: galleryLoader('photos') })
 *   albums: defineCollection({ loader: galleryLoader('albums') })
 *
 * Each entry’s `digest` is the manifest digest, so unchanged entries are not
 * rewritten, and pages build their incremental `cacheKey` from it.
 */
export function galleryLoader(
  kind: 'photos' | 'albums',
  options: GalleryLoaderOptions = {}
): Loader {
  return {
    name: `@minimalgallery/astro:${kind}`,
    schema: kind === 'photos' ? PhotoEntry : AlbumEntry,
    async load(ctx) {
      const dir = galleryDirOf(ctx, options);
      // Only the dev server has a watcher, and serves the bucket stage.
      const mediaBase = ctx.watcher
        ? `${ctx.config.base.replace(/\/?$/, '/')}_mg/`
        : undefined;
      const sync = async () => {
        const { albums, photos } = await readManifests(dir, mediaBase);
        const albumIds = new Set(albums.map((a) => a.id));
        const seen = new Set<string>();
        let changed = 0;
        const put = async (
          id: string,
          digest: string,
          markdown: string | null | undefined,
          data: (html: string | null) => Record<string, unknown>
        ) => {
          if (seen.has(id)) throw new Error(`duplicate ${kind} id ${id}`);
          seen.add(id);
          if (ctx.store.get(id)?.digest === digest) return;
          const rendered = markdown
            ? await ctx.renderMarkdown(markdown)
            : undefined;
          ctx.store.set({
            id,
            digest,
            data: await ctx.parseData({
              id,
              data: data(rendered?.html ?? null),
            }),
            ...(markdown ? { body: markdown, rendered } : {}),
          });
          changed++;
        };
        if (kind === 'photos') {
          for (const p of photos) {
            // In dev, a run writes a new album’s photos before
            // `_albums.json`; they show once it lands.
            if (!albumIds.has(p.album) && ctx.watcher) continue;
            if (!albumIds.has(p.album))
              throw new Error(
                `photo ${p.id} refers to unknown album ${p.album}`
              );
            await put(p.id, p.digest, p.caption, (captionHtml) => ({
              ...p,
              url: photoUrl(p.album, p.slug),
              albumUrl: albumUrl(p.album),
              captionHtml,
            }));
          }
        } else {
          for (const a of albums) {
            const { photoIds, order, dateRange, ...rest } = a;
            await put(
              a.id,
              `${a.digest}.${ADAPTER_VERSION}`,
              a.description,
              (descriptionHtml) => ({
                ...rest,
                photoIds,
                url: albumUrl(a.id),
                descriptionHtml,
                digest: `${a.digest}.${ADAPTER_VERSION}`,
              })
            );
          }
        }
        let removed = 0;
        for (const id of ctx.store.keys())
          if (!seen.has(id)) {
            ctx.store.delete(id);
            removed++;
          }
        ctx.logger.info(
          `${kind}: ${seen.size} entries, ${changed} updated, ${removed} removed`
        );
      };
      await sync();
      // In dev, reload when the pipeline rewrites a manifest.
      if (ctx.watcher) {
        const manifestDir = join(dir, MANIFEST_DIR);
        ctx.watcher.add(manifestDir);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const onChange = (path: string) => {
          if (!path.startsWith(manifestDir)) return;
          clearTimeout(timer);
          timer = setTimeout(
            () => sync().catch((e) => ctx.logger.error(String(e))),
            200
          );
        };
        for (const ev of ['change', 'add', 'unlink'] as const)
          ctx.watcher.on(ev, onChange);
      }
    },
  };
}
