import { build } from 'vite';
import { cp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../website', import.meta.url));
const outDir = fileURLToPath(new URL('../site-dist', import.meta.url));
await build({ configFile: false, root, base: './', publicDir: false, build: { outDir, emptyOutDir: true } });
await cp(new URL('../docs/images', import.meta.url), new URL('../site-dist/images', import.meta.url), { recursive: true });
await writeFile(new URL('../site-dist/.nojekyll', import.meta.url), '');
