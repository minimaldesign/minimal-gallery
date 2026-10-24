// The same feed as JSON Feed 1.1.
import type { APIRoute } from 'astro';
import { jsonFeed } from '@minimalgallery/astro/feeds';

export const GET: APIRoute = async ({ site }) =>
  new Response(JSON.stringify(await jsonFeed({ site })), {
    headers: { 'Content-Type': 'application/feed+json; charset=utf-8' },
  });
