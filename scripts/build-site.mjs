import { build } from 'vite';
import { cp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { websiteRepositoryLinks } from './website-links.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const root = fileURLToPath(new URL('../website', import.meta.url));
const outDir = fileURLToPath(new URL('../site-dist', import.meta.url));
function checkoutRef() {
  const options = { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    return execFileSync('git', ['branch', '--show-current'], options).trim()
      || execFileSync('git', ['rev-parse', 'HEAD'], options).trim();
  } catch {
    // Source archives have no Git metadata; published documentation uses main.
    return 'main';
  }
}
const docsRef = process.env.WEBSITE_DOCS_REF ?? checkoutRef();
await build({
  configFile: false, root, base: './', publicDir: false,
  plugins: [{
    name: 'website-repository-links',
    transformIndexHtml: html => websiteRepositoryLinks(html, docsRef),
  }],
  build: { outDir, emptyOutDir: true },
});
await cp(new URL('../docs/images', import.meta.url), new URL('../site-dist/images', import.meta.url), { recursive: true });
await writeFile(new URL('../site-dist/.nojekyll', import.meta.url), '');
