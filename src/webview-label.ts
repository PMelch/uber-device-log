import type { WebView } from '../shared/types';

function parts(view: WebView) {
  let domain = '', path = '';
  try {
    const url = new URL(view.url);
    domain = url.host;
    path = url.pathname;
  } catch { /* Invalid URLs remain available verbatim in details. */ }
  const title = view.title.trim();
  const name = title && title !== view.url && !/^[a-z][\w+.-]*:\/\//i.test(title) ? title : domain;
  return { name, domain, path };
}

/** Compact presentation only; never change source metadata or exported URLs. */
export function webViewLabel(view: WebView, siblings: WebView[] = []) {
  const own = parts(view);
  const matches = siblings.filter(other => {
    const item = parts(other);
    return item.name === own.name && item.domain === own.domain;
  });
  const duplicate = matches.length > 1;
  const samePath = matches.filter(other => parts(other).path === own.path);
  const path = duplicate && own.path !== '/' ? own.path : '';
  // Preserve the full ID when short prefixes would still be ambiguous.
  const id = duplicate && samePath.length > 1
    ? (samePath.filter(other => other.id.slice(0, 8) === view.id.slice(0, 8)).length > 1 ? view.id : view.id.slice(0, 8)) : '';
  return { name: own.name, subtitle: [own.domain !== own.name ? own.domain : '', path, id].filter(Boolean).join(' · ') };
}

export function compactContextUrl(value: string) {
  let location = value.split(/[?#]/, 1)[0] ?? '';
  try {
    const url = new URL(value);
    location = ['data:', 'javascript:', 'blob:'].includes(url.protocol)
      ? url.protocol
      : (url.host || url.protocol) + (url.pathname === '/' ? '' : url.pathname);
  } catch { /* Frame identifiers and relative paths can also appear here. */ }
  return location.length > 64 ? location.slice(0, 39) + '…' + location.slice(-24) : location;
}
