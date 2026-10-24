// The RSS feed of the newest photos, linked from every page's head.
import type { APIRoute } from 'astro';
import { rssFeed } from '@minimalgallery/astro/feeds';

export const GET: APIRoute = async ({ site }) =>
  new Response(await rssFeed({ site }), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
