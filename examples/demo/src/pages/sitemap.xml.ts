// Every context page and photo page, for search engines.
import type { APIRoute } from 'astro';
import { sitemap } from '@minimalgallery/astro/feeds';

export const GET: APIRoute = async ({ site }) =>
  new Response(await sitemap({ site }), {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
