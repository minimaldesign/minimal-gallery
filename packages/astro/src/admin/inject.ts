/**
 * Dev-only wiring of the admin. Called from `astro:config:setup`; does
 * nothing unless the command is `astro dev`, so a build never loads the
 * admin’s page, API or dependencies.
 */
import type { HookParameters } from 'astro';
import { utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { findConfigFile } from '@minimalgallery/pipeline/config';

type ViteDevServer = HookParameters<'astro:server:setup'>['server'];

export async function setupAdmin(
  params: HookParameters<'astro:config:setup'>,
  galleryDir: string
): Promise<void> {
  const { command, config, injectRoute, addWatchFile, updateConfig, logger } =
    params;
  if (command !== 'dev') return;
  injectRoute({
    pattern: '/_mg/admin',
    entrypoint: new URL('./ui/AdminPage.astro', import.meta.url),
    prerender: false,
  });
  // A settings edit rewrites the config; restarting picks up the new values.
  addWatchFile(
    (await findConfigFile(galleryDir)) ??
      join(galleryDir, 'minimalgallery.config.ts')
  );
  let close: (() => void) | undefined;
  const plugin = {
    name: 'minimalgallery:admin',
    apply: 'serve' as const,
    enforce: 'post' as const,
    async configureServer(server: ViteDevServer) {
      const { createAdminApi } = await import('./server/index.ts');
      const api = createAdminApi({
        galleryDir,
        base: config.base,
        watcher: server.watcher,
        // Touching the watched config restarts through Astro, which runs
        // the integration again; a plain Vite restart would not.
        restart: async () => {
          const file = await findConfigFile(galleryDir);
          if (!file) return server.restart();
          const now = new Date();
          await utimes(file, now, now);
        },
        log: (m) => logger.warn(m),
      });
      let closed = false;
      close = () => {
        if (closed) return;
        closed = true;
        void api.close();
      };
      server.httpServer?.once('close', close);
      // After Astro’s own middleware is in place: go first, so admin
      // requests are checked before anything else sees them, and are not
      // subject to the base and trailing-slash rules meant for pages.
      return () => {
        server.middlewares.stack.unshift({
          route: '',
          handle: (req: any, res: any, next: (e?: unknown) => void) => {
            api.handle(req, res).then((done) => done || next(), next);
          },
        });
      };
    },
    // Vite closes the plugins when the dev server stops or restarts. The
    // queue, uploads and jobs live on in the registry for the next instance.
    closeBundle() {
      close?.();
    },
  };
  updateConfig({
    vite: {
      plugins: [plugin],
      // Upload chunks and the bucket-mode stage change often and feed no page.
      server: { watch: { ignored: ['**/.minimalgallery/cache/**'] } },
    },
  });
}
