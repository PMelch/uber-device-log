import { BUNDLE_FILE_LIMIT } from './flow-bundles.js';
export async function downloadFlowBundle(value: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<Buffer> {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Enter a .blueprint HTTP(S) URL.');
  let url = new URL(value);
  if (!/\.blueprint$/i.test(url.pathname)) throw new Error('Bundle URL must identify a .blueprint file.');
  const abort = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Bundle URL must use HTTP(S) without embedded credentials.');
    const response = await fetcher(url, { redirect: 'manual', signal: abort, credentials: 'omit' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location'); if (!location || redirects === 5) throw new Error('Bundle redirect limit exceeded or missing destination.');
      const next = new URL(location, url); if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('Bundle redirects cannot downgrade HTTPS.'); url = next; continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Bundle download failed (HTTP ${response.status}).`); }
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > BUNDLE_FILE_LIMIT)) { await response.body.cancel(); throw new Error('Bundle download exceeds the 4 MiB limit.'); }
    const reader = response.body.getReader(); const chunks: Buffer[] = []; let size = 0;
    try {
      while (true) { abort.throwIfAborted(); const { done, value: chunk } = await reader.read(); if (done) break; size += chunk.length; if (size > BUNDLE_FILE_LIMIT) throw new Error('Bundle download exceeds the 4 MiB limit.'); chunks.push(Buffer.from(chunk)); }
      if (declared && size !== Number(declared)) throw new Error('Bundle download is truncated.');
      return Buffer.concat(chunks);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  throw new Error('Bundle redirect limit exceeded.');
}
