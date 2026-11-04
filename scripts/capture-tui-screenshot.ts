// Run with Bun. Captures the real TUI render buffer using only fictional fixtures.
// CHROME_EXECUTABLE and PLAYWRIGHT_MODULE match the browser regression scripts.
import { createTestRenderer } from '@opentui/core/testing';
import { TextAttributes } from '@opentui/core';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTui } from '../tui/app';
import { sourceKey } from '../tui/local-client';
import type { Device, LogMessage } from '../shared/types';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const terminal = await createTestRenderer({ width: 172, height: 42 });
const device: Device = { id: 'demo-pixel', name: 'Demo Pixel', platform: 'android', state: 'connected' };
const webview: Device = { ...device, webview: { id: 'checkout', socket: 'demo-webview', title: 'Checkout', url: 'https://shop.example.test' } };
const app = createTui(terminal.renderer, {
  locale: 'en', theme: 'dark', detectTerminalTheme: false, project: 'demo-shop',
  demo: true, sourceRefreshMs: 0, sources: async () => [device, webview], syncSources() {},
});
let browser;
try {
  await app.refreshSources();
  app.toggleSource(device); app.toggleSource(webview);
  const fixtures: [string, string, boolean][] = [
    ['INFO', 'Checkout started: cart DEMO-2048', false],
    ['INFO', 'Checkout bridge connected', true],
    ['DEBUG', 'GET /api/cart started', false],
    ['INFO', 'Cart received: 3 items', true],
    ['INFO', 'GET /api/cart -> 200 (48 ms)', false],
    ['INFO', 'Total updated: EUR 129.00', true],
    ['WARN', 'Image cache miss; fetching preview', true],
    ['DEBUG', 'Payment handler registered', false],
    ['INFO', 'Payment sheet opened', false],
    ['INFO', 'Confirm button pressed', true],
    ['INFO', 'POST /api/payment started', false],
    ['WARN', 'Payment response delayed: 840 ms', false],
    ['INFO', 'Showing payment progress', true],
    ['ERROR', 'Payment request timed out\njava.net.SocketTimeoutException: demo timeout\n    at demo.PaymentClient.authorize(PaymentClient.java:42)\n    at demo.Checkout.confirm(Checkout.java:108)', false],
    ['WARN', 'Retry action is available', true],
    ['INFO', 'Retry requested by demo user', true],
    ['INFO', 'POST /api/payment -> 200 (62 ms)', false],
    ['INFO', 'Payment authorized: DEMO-PAY-2048', false],
    ['INFO', 'Confirmation displayed', true],
    ['INFO', 'Checkout completed', false],
  ];
  const records: LogMessage[] = fixtures.map(([level, message, web], i) => {
    const source = web ? webview : device;
    return { timestamp: new Date(Date.UTC(2026, 10, 4, 10, 42, i, web ? 250 : 0)).toISOString(),
      level, message, tag: web ? 'console' : 'Checkout', pid: web ? 2418 : 1936,
      source: { key: sourceKey(source), name: web ? 'WebView' : 'Device', platform: 'android', deviceId: device.id, ...(web ? { webview: webview.webview } : {}) } };
  });
  app.ingest(records);
  app.model.select(app.model.rows().find(row => row.level === 'ERROR')!.key);
  app.setStatus('Fictional demo capture · native + WebView', true);
  app.controls.logs.focus();
  await terminal.renderOnce();
  const frame = terminal.captureSpans();
  const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
  const color = (rgba: { toInts(): number[] }) => `rgb(${rgba.toInts().slice(0, 3).join(',')})`;
  const cell = 9, line = 19, left = 26, top = 51;
  const shapes = [`<rect width="1600" height="900" fill="${app.theme.background}"/>`];
  frame.lines.forEach((row, y) => {
    let x = 0;
    for (const span of row.spans) {
      const width = span.width * cell;
      shapes.push(`<rect x="${left + x * cell}" y="${top + y * line}" width="${width}" height="${line}" fill="${color(span.bg)}"/>`);
      // Position glyphs by terminal cells so SVG whitespace normalization cannot
      // stretch severity labels or erase the separators between colored spans.
      let offset = 0;
      for (const char of span.text) {
        if (char.trim()) shapes.push(`<text x="${left + (x + offset) * cell}" y="${top + y * line + 14}" textLength="${Bun.stringWidth(char) * cell}" lengthAdjust="spacingAndGlyphs" fill="${color(span.fg)}" font-weight="${span.attributes & TextAttributes.BOLD ? 700 : 400}">${escape(char)}</text>`);
        offset += Bun.stringWidth(char);
      }
      x += span.width;
    }
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><g font-family="Menlo,DejaVu Sans Mono,monospace" font-size="14" style="white-space:pre" xml:space="preserve">${shapes.join('')}</g></svg>`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  const path = fileURLToPath(new URL('../docs/images/terminal-viewer.png', import.meta.url));
  await mkdir(fileURLToPath(new URL('../docs/images/', import.meta.url)), { recursive: true });
  await page.screenshot({ path });
  console.log(`Captured real TUI buffer (172 × 42 cells) with fictional logs: ${path}`);
} finally {
  await browser?.close();
  app.dispose(); await terminal.dispose();
}
