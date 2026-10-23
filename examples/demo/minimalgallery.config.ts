import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({
  name: 'minimal gallery',
  description: 'The minimal gallery demo: photographs from 2004 to 2013.',
  // Bucket mode: the resized photos live in the minimalgallery-media R2
  // bucket and are served from media.minimalgallery.net. The repository holds
  // the photos and their manifests, so the Cloudflare build only runs astro
  // build. Uploads need MG_S3_ACCESS_KEY_ID and MG_S3_SECRET_ACCESS_KEY in
  // examples/demo/.env (an R2 API token with Object Read & Write).
  storage: {
    mode: 's3',
    bucket: 'minimalgallery-media',
    endpoint:
      'https://b1b035b6ac2f46a71da25be064506a5c.r2.cloudflarestorage.com',
    publicUrl: 'https://media.minimalgallery.net',
  },
  // The viewer as a first-time visitor sees it; visitors can switch each
  // one, and their choice is remembered.
  defaults: {
    fit: 'fill',
    strip: false,
    crop: 'square',
    view: 'grid',
    size: 2,
    backdrop: 'neutral',
  },
});
