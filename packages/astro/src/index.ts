import type { AstroIntegration } from 'astro';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import globalData from '@csstools/postcss-global-data';
import postcssMixins from 'postcss-mixins';
import postcssPresetEnv from 'postcss-preset-env';
import { applyDefaultsToTokens, resolveConfig } from './config.ts';
import { setupAdmin } from './admin/inject.ts';
import { fontsourceVariable } from './fonts.ts';
import { setSharedOptions, type MinimalgalleryOptions } from './options.ts';

export type { MinimalgalleryOptions } from './options.ts';
export type { GalleryConfig, ViewerDefaults } from './config.ts';
export { galleryLoader } from './loader.ts';

/** The dev and preview port, the same on every start so it can be bookmarked. */
export const DEFAULT_PORT = 4800;
/** Astro's own default: a project with this port did not choose one. */
const ASTRO_PORT = 4321;

const CONFIG_ID = 'virtual:minimalgallery/config';
const CUSTOM_ID = 'virtual:minimalgallery/custom.css';
const EMPTY_CUSTOM = '\0minimalgallery-custom.css';
const TOKENS_FILE = '/theme/styles/site/theme.mg.tokens.css';
const MEDIA_QUERIES = fileURLToPath(
  new URL(
    './theme/styles/framework/settings.media-queries.css',
    import.meta.url
  )
);

/**
 * The minimalgallery Astro integration. It resolves the gallery config,
 * shares it with the content loader and the theme (as a virtual module),
 * writes the viewer defaults into the token contract, sets up the PostCSS
 * chain the mCSS theme needs, and links the owner's `custom.css` as the last
 * stylesheet.
 */
export default function minimalgallery(
  options: MinimalgalleryOptions = {}
): AstroIntegration {
  return {
    name: '@minimalgallery/astro',
    hooks: {
      'astro:config:setup': async (params) => {
        const { config, updateConfig, logger } = params;
        const root = fileURLToPath(config.root);
        const { galleryDir: dir, ...overrides } = options;
        const galleryDir = resolve(root, dir ?? '.');
        const gallery = await resolveConfig(galleryDir, overrides);
        setSharedOptions({ ...options, galleryDir });
        const customCss = resolve(galleryDir, 'custom.css');
        // 4800 unless astro.config.mjs or --port chose another. Strict, so a
        // taken port stops the server instead of moving it to the next one
        // and leaving a bookmark on whatever else is listening there.
        const portFlag = process.argv.some(
          (a) => a === '--port' || a.startsWith('--port=')
        );
        const port =
          config.server.port === ASTRO_PORT && !portFlag
            ? DEFAULT_PORT
            : config.server.port;

        updateConfig({
          server: { port },
          // Geist and Geist Mono, self-hosted: the variable files, Latin
          // first (the layout preloads it), other subsets by unicode-range
          fonts: [
            {
              provider: fontsourceVariable('@fontsource-variable/geist'),
              name: 'Geist',
              cssVariable: '--mg-font-text',
              weights: ['100 900'],
              styles: ['normal'],
              subsets: ['latin', 'latin-ext'],
              fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
              display: 'swap',
            },
            {
              provider: fontsourceVariable('@fontsource-variable/geist-mono'),
              name: 'Geist Mono',
              cssVariable: '--mg-font-mono',
              weights: ['100 900'],
              styles: ['normal'],
              subsets: ['latin', 'latin-ext'],
              fallbacks: ['ui-monospace', 'monospace'],
              display: 'swap',
            },
          ],
          vite: {
            server: { strictPort: true },
            preview: { strictPort: true },
            // The helpers import `astro:content`, so Vite must bundle this
            // package rather than load it from node_modules as plain Node code.
            ssr: { noExternal: ['@minimalgallery/astro'] },
            css: {
              postcss: {
                plugins: [
                  // @custom-media names reach every file Vite compiles alone
                  globalData({ files: [MEDIA_QUERIES] }),
                  postcssMixins(),
                  postcssPresetEnv({
                    stage: 2,
                    browsers: 'baseline 2024',
                    features: {
                      // mCSS ships native cascade layers: keep them
                      'cascade-layers': false,
                      'random-function': false,
                    },
                  }),
                ],
              },
            },
            plugins: [
              {
                name: 'minimalgallery:config',
                enforce: 'pre',
                resolveId(id) {
                  if (id === CONFIG_ID) return '\0' + CONFIG_ID;
                  if (id === CUSTOM_ID)
                    return existsSync(customCss) ? customCss : EMPTY_CUSTOM;
                },
                load(id) {
                  if (id === '\0' + CONFIG_ID)
                    return `export default ${JSON.stringify(gallery)};`;
                  if (id === EMPTY_CUSTOM) return '';
                },
                async transform(code, id) {
                  if (!id.split('?')[0].endsWith(TOKENS_FILE)) return;
                  return {
                    code: applyDefaultsToTokens(code, gallery.defaults),
                    map: null,
                  };
                },
              },
            ],
          },
        });
        // The browser admin, under astro dev only.
        await setupAdmin(params, galleryDir);
        if (
          config.experimental?.incrementalBuild &&
          (config.build?.concurrency ?? 1) > 1
        ) {
          logger.warn(
            'experimental.incrementalBuild is ignored when build.concurrency > 1; every page will render.'
          );
        }
      },
    },
  };
}
