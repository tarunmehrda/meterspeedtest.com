import type { APIRoute } from 'astro';

// Serves /sitemap.xml as a real XML urlset. Prerendered to a static file at
// build time (dist/sitemap.xml), so the host serves it as application/xml.
export const prerender = true;

const SITE = 'https://meterspeedtest.com';

// Auto-enumerate every static page so the sitemap can never drift from the
// actual routes. Add a page under src/pages/ and it shows up here for free.
const pageFiles = import.meta.glob('./**/*.{astro,md,mdx,html}');

/** Turn a src/pages file path into its canonical, trailing-slash route. */
function fileToRoute(file: string): string | null {
  // e.g. "./about.astro" -> "/about", "./index.astro" -> "/index"
  let route = file.replace(/^\.\//, '/').replace(/\.(astro|md|mdx|html)$/, '');

  // Keep utility and dynamic routes out of the sitemap.
  if (/(^|\/)404$/.test(route)) return null; // 404 page is noindex
  if (route.includes('[')) return null; // dynamic route templates

  route = route.replace(/\/index$/, '/'); // "/blog/index" -> "/blog/"
  if (route === '/index') route = '/'; // homepage
  if (route !== '/' && !route.endsWith('/')) route += '/'; // match build output

  return route;
}

export const GET: APIRoute = () => {
  const lastmod = new Date().toISOString();

  const routes = Object.keys(pageFiles)
    .map(fileToRoute)
    .filter((route): route is string => route !== null)
    .sort();

  const urls = routes
    .map((route) => {
      const loc = new URL(route, SITE).href;
      const isHome = route === '/';
      // Homepage is the priority landing target; supporting pages rank below it.
      const priority = isHome ? '1.0' : '0.7';
      const changefreq = isHome ? 'daily' : 'weekly';
      return [
        '  <url>',
        `    <loc>${loc}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        '  </url>',
      ].join('\n');
    })
    .join('\n');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
