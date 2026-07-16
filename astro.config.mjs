// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://meterspeedtest.com',
  integrations: [
    sitemap({
      // Keep noindex error pages (/400, /403, /503, …) out of the sitemap.
      // Astro already omits the special 404/500 routes automatically.
      filter: (page) => !/\/[45]\d\d\/?$/.test(page),
      // Homepage is the priority landing target; supporting pages rank below it.
      serialize(item) {
        item.changefreq = 'weekly';
        item.lastmod = new Date().toISOString();
        if (item.url === 'https://meterspeedtest.com/') {
          item.priority = 1.0;
          item.changefreq = 'daily';
        } else {
          item.priority = 0.7;
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
