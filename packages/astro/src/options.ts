import type { GalleryConfigInput } from './config.ts';

/**
 * Options for the integration. `galleryDir` says where the gallery lives;
 * every other key overrides the same key of `minimalgallery.config.ts`.
 */
export interface MinimalgalleryOptions extends GalleryConfigInput {
  /** Directory holding `photos/`, `.minimalgallery/` and the config file. Defaults to the Astro project root. */
  galleryDir?: string;
}

const KEY = Symbol.for('@minimalgallery/astro/options');

/** The integration stores its options here so the loader can read them from `content.config.ts`. */
export function setSharedOptions(options: MinimalgalleryOptions): void {
  (globalThis as Record<symbol, unknown>)[KEY] = options;
}

export function getSharedOptions(): MinimalgalleryOptions {
  return (
    ((globalThis as Record<symbol, unknown>)[KEY] as
      MinimalgalleryOptions | undefined) ?? {}
  );
}
