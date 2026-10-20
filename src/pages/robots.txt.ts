import type { APIRoute } from 'astro';

/** robots.txt: crawl everything except the client-side species fallback, and point at the sitemap. */
export const GET: APIRoute = ({ site }) => {
  const sitemap = site ? new URL('sitemap-index.xml', site).href : '/sitemap-index.xml';
  return new Response(`User-agent: *\nAllow: /\nDisallow: /species/view\n\nSitemap: ${sitemap}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
