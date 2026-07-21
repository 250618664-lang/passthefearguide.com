import type { APIRoute } from 'astro';
import { siteConfig } from '../../site.config.mjs';

export const GET: APIRoute = () => {
  // Production build: allow all crawlers
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${siteConfig.siteUrl}/sitemap.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
