import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { startupHtml } from './scripts/startup-html';
import { readFileSync } from 'node:fs';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string;

export default defineConfig({
  plugins: [vue(), { name: 'startup-label', transformIndexHtml: startupHtml }],
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageVersion) },
});
