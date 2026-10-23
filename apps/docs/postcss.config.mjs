// The PostCSS chain mCSS needs, the same as the gallery’s (set by the
// @minimalgallery/astro integration): the framework’s @custom-media names in
// every file Vite compiles alone, mixins, and preset-env on Baseline 2024
// with native cascade layers kept.
import { fileURLToPath } from 'node:url';
import globalData from '@csstools/postcss-global-data';
import postcssMixins from 'postcss-mixins';
import postcssPresetEnv from 'postcss-preset-env';

const mediaQueries = fileURLToPath(
  import.meta
    .resolve('@minimalgallery/astro/theme/styles/framework/settings.media-queries.css')
);

export default {
  plugins: [
    globalData({ files: [mediaQueries] }),
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
};
