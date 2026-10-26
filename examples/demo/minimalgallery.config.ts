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
});
