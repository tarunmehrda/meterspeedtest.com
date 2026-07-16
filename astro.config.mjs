// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://meterspeedtest.com',
  integrations: [
    sitemap({
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
