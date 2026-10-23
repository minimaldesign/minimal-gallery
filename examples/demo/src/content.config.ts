import { defineCollection } from 'astro:content';
import { galleryLoader } from '@minimalgallery/astro/loader';

export const collections = {
  albums: defineCollection({ loader: galleryLoader('albums') }),
  photos: defineCollection({ loader: galleryLoader('photos') }),
};
