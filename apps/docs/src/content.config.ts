import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { changelogLoader } from './lib/changelog';

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // The packages’ CHANGELOG.md files, written by changesets, one entry per
  // version (src/pages/versions.astro)
  versions: defineCollection({
    loader: changelogLoader(new URL('../../../packages/', import.meta.url)),
    schema: z.object({ version: z.string(), order: z.number() }),
  }),
};
