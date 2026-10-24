// Crawling allowed everywhere; points at the sitemap when the site’s
// address is set.
import type { APIRoute } from 'astro';
import { robotsTxt } from '@minimalgallery/astro/feeds';

export const GET: APIRoute = ({ site }) => new Response(robotsTxt({ site }));
