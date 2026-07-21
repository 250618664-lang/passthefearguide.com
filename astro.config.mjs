import { defineConfig } from 'astro/config';
import { siteConfig } from './site.config.mjs';

export default defineConfig({
  site: siteConfig.siteUrl,
  output: 'static',
  build: {
    assets: '_assets',
  },
  vite: {
    build: {
      cssMinify: true,
    },
  },
});
