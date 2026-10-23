// v0.8 photo ids to page URLs, read by the home page for `/?id=` links.
import type { APIRoute } from 'astro';
import { legacyIds } from '@minimalgallery/astro/gallery';

export const GET: APIRoute = async () => Response.json(await legacyIds());
