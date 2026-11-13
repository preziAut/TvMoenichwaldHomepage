import { defineConfig } from 'astro/config';
import tailwind from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import responsiveImages from './scripts/responsive-images.mjs';
export default defineConfig({ site: 'https://www.tv-moenichwald.at', output: 'static', trailingSlash: 'always', markdown: {rehypePlugins:[responsiveImages]}, integrations: [sitemap()], vite: { plugins: [tailwind()], ssr: { external: ['yaml'] } } });
