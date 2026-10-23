import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { fontProviders } from 'astro/config';

type FontProvider = ReturnType<typeof fontProviders.local>;

const require = createRequire(import.meta.url);
const SUBSET =
  /-(latin-ext|latin|cyrillic-ext|cyrillic|greek-ext|greek|vietnamese)-wght-normal\.woff2$/;

/**
 * A font provider for a Fontsource variable package installed with this
 * one (`@fontsource-variable/geist`): its upright faces read from disk, one
 * per subset, each with its unicode-range and its subset name, so a layout
 * can preload the Latin file alone. Nothing is fetched from a CDN, at build
 * time or in the browser.
 */
export function fontsourceVariable(pkg: string) {
  const css = require.resolve(`${pkg}/wght.css`);
  const provider = {
    name: 'minimalgallery-fontsource',
    config: { pkg },
    resolveFont: ({ subsets }: { subsets: string[] }) => {
      const fonts = [];
      for (const [, face] of readFileSync(css, 'utf8').matchAll(
        /@font-face\s*{([^}]*)}/g
      )) {
        const file = face.match(/url\(\.\/files\/([^)]+)\)/)?.[1] ?? '';
        const subset = file.match(SUBSET)?.[1];
        if (!subset || (subsets.length && !subsets.includes(subset))) continue;
        const range = face.match(/unicode-range:\s*([^;]+);/)?.[1];
        fonts.push({
          src: [{ url: join(dirname(css), 'files', file), format: 'woff2' }],
          weight: '100 900',
          style: 'normal',
          unicodeRange: range?.split(',').map((r) => r.trim()),
          meta: { subset },
        });
      }
      return { fonts };
    },
  };
  return provider as unknown as FontProvider;
}
