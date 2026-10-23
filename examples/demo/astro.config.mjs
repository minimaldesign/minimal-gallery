// @ts-check
import { defineConfig } from 'astro/config';
import minimalgallery from '@minimalgallery/astro';

export default defineConfig({
  site: 'https://minimalgallery.net',
  output: 'static',
  trailingSlash: 'always',
  integrations: [
    // Gallery name and viewer defaults live in minimalgallery.config.ts.
    minimalgallery(),
  ],
  experimental: {
    // Pages whose cacheKey (built from manifest digests) and code are
    // unchanged are not rendered again. Restore node_modules/.astro
    // between CI builds to keep the cache.
    incrementalBuild: true,
  },
});
