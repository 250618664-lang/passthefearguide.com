import type { APIRoute } from 'astro';
import { enabledGuides } from '../data/guides';
import { siteConfig } from '../../site.config.mjs';

const paths = ['/', ...enabledGuides.map((guide) => `/${guide.slug}/`)];

export const GET: APIRoute = () => {
  const urls = paths.map((path) => `  <url><loc>${new URL(path, siteConfig.siteUrl).toString()}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
