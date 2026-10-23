import type { AstroIntegration } from 'astro';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import globalData from '@csstools/postcss-global-data';
import postcssMixins from 'postcss-mixins';
import postcssPresetEnv from 'postcss-preset-env';
import { applyDefaultsToTokens, resolveConfig } from './config.ts';
import { setSharedOptions, type MinimalgalleryOptions } from './options.ts';

export type { MinimalgalleryOptions } from './options.ts';
export type { GalleryConfig, ViewerDefaults } from './config.ts';
export { galleryLoader } from './loader.ts';

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
      'astro:config:setup': async ({ config, updateConfig, logger }) => {
        const root = fileURLToPath(config.root);
        const { galleryDir: dir, ...overrides } = options;
        const galleryDir = resolve(root, dir ?? '.');
        const gallery = await resolveConfig(galleryDir, overrides);
        setSharedOptions({ ...options, galleryDir });
        const customCss = resolve(galleryDir, 'custom.css');

        updateConfig({
          vite: {
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
