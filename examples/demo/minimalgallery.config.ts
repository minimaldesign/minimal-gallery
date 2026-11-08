import { defineConfig } from '@minimalgallery/pipeline/config';

export default defineConfig({
  name: 'minimal gallery',
  description: 'The minimal gallery demo: photographs from 2004 to 2013.',
  logo: './logo.svg',

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

  saveEdits: 'photo',

  // The resized photos live in R2 and are served from their own domain;
  // the R2 token is in .env (MG_S3_ACCESS_KEY_ID, MG_S3_SECRET_ACCESS_KEY).
  storage: {
    mode: 's3',
    bucket: 'minimalgallery-media',
    endpoint:
      'https://b1b035b6ac2f46a71da25be064506a5c.r2.cloudflarestorage.com',
    publicUrl: 'https://media.minimalgallery.net',
  },
});
