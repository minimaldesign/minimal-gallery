// The context JSON beside every context page (/grid.json, /colors.json,
// /camera/nikon-d70.json): what the theme script needs for `?in=`.
import type { APIRoute, GetStaticPaths } from 'astro';
import {
  contextDigest,
  contextJson,
  getContexts,
  type Context,
} from '@minimalgallery/astro/gallery';

export const getStaticPaths = (async () =>
  Promise.all(
    (await getContexts()).map(async (context) => ({
      params: { context: context.id },
      props: { context },
      cacheKey: await contextDigest(context),
    }))
  )) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  Response.json(contextJson((props as { context: Context }).context));
