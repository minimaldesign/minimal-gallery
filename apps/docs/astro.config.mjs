// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import starlight from '@astrojs/starlight';

// docs.minimalgallery.net: the product site. The home page
// (src/pages/index.astro) is the one-pager, built on mCSS with the gallery’s
// own theme tokens; the docs behind it are Starlight, restyled with the same
// tokens (src/styles/starlight.css).
export default defineConfig({
  site: 'https://docs.minimalgallery.net',
  trailingSlash: 'always',
  // One address for dev and preview, next to the gallery’s 4800, and an
  // error instead of the next free port when it is taken, so a bookmark
  // always opens the docs.
  server: { port: 4801 },
  vite: {
    server: { strictPort: true },
    preview: { strictPort: true },
  },
  // Pages that were removed when the docs dropped GitHub Pages and Netlify.
  redirects: {
    '/hosting/github-pages/': '/hosting/',
    '/hosting/netlify/': '/hosting/',
  },
  // Geist and Geist Mono, self-hosted from their Fontsource packages, as in
  // the gallery. Latin only: the docs are in English.
  fonts: [
    {
      provider: fontProviders.local(),
      name: 'Geist',
      cssVariable: '--mg-font-text',
      fallbacks: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      options: {
        variants: [
          {
            src: [
              '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
            ],
            weight: '100 900',
            style: 'normal',
            display: 'swap',
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: 'Geist Mono',
      cssVariable: '--mg-font-mono',
      fallbacks: ['ui-monospace', 'monospace'],
      options: {
        variants: [
          {
            src: [
              '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
            ],
            weight: '100 900',
            style: 'normal',
            display: 'swap',
          },
        ],
      },
    },
  ],
  integrations: [
    starlight({
      title: 'minimal gallery',
      description:
        'A photo gallery for photographers: turn folders of photos into a fast website, on free hosting.',
      favicon: '/favicon.svg',
      logo: { src: './src/assets/logo.svg' },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/minimaldesign/minimal-gallery',
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/minimaldesign/minimal-gallery/edit/master/apps/docs/',
      },
      // The product is dark only: no theme picker, no light palette.
      components: {
        Head: './src/components/starlight/Head.astro',
        ThemeProvider: './src/components/starlight/ThemeProvider.astro',
        ThemeSelect: './src/components/starlight/ThemeSelect.astro',
      },
      customCss: ['./src/styles/starlight.css'],
      expressiveCode: {
        themes: ['min-dark'],
        styleOverrides: {
          borderRadius: '10px',
          borderColor: 'var(--mg-hairline)',
          codeFontFamily: 'var(--mono)',
          codeFontSize: '0.8125rem',
          uiFontFamily: 'var(--text)',
          codeBackground: 'var(--mg-gray-100)',
          frames: {
            shadowColor: 'transparent',
            editorTabBarBackground: 'var(--mg-gray-100)',
            editorActiveTabBackground: 'var(--mg-gray-100)',
            terminalTitlebarBackground: 'var(--mg-gray-100)',
            terminalBackground: 'var(--mg-gray-100)',
            terminalTitlebarBorderBottomColor: 'var(--mg-hairline)',
            editorTabBarBorderBottomColor: 'var(--mg-hairline)',
            editorActiveTabIndicatorTopColor: 'transparent',
          },
        },
      },
      sidebar: [
        {
          label: 'Start here',
          items: [{ label: 'Getting started', link: '/getting-started/' }],
        },
        {
          label: 'Putting it online',
          items: [
            { label: 'Choosing how', link: '/hosting/' },
            { label: 'Cloudflare', link: '/hosting/cloudflare/' },
            { label: 'Photo storage', link: '/hosting/photo-storage/' },
            { label: 'Your own host', link: '/hosting/your-own-host/' },
            { label: 'Backups', link: '/backups/' },
          ],
        },
        {
          label: 'Customize',
          items: [{ label: 'Theme and tokens', link: '/theme/' }],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Configuration', link: '/reference/configuration/' },
            { label: 'Sidecars', link: '/reference/sidecars/' },
            { label: 'Command line', link: '/reference/cli/' },
          ],
        },
        {
          label: 'Project',
          items: [
            { label: 'Version history', link: '/versions/' },
            { label: 'Downloads', link: '/downloads/' },
          ],
        },
      ],
    }),
  ],
});
