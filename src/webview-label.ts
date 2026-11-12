import type { ConsoleContext } from '../shared/console';
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

export function consoleContextLabel(item: ConsoleContext, full = false) {
  const location = item.url || item.frame;
  const name = item.name || (item.top ? 'top' : 'iframe');
  if (full) return `${name} · ${location}`;
  const shortLocation = compactContextUrl(location);
  if (name === location) return shortLocation;
  const shortName = /^[a-z][\w+.-]*:/i.test(name) ? compactContextUrl(name) : name;
  return `${shortName} · ${shortLocation}`;
}

export function consoleContextLabels(contexts: ConsoleContext[]) {
  const labels = new Map<string, string>();
  const seen = new Set<string>(), duplicates = new Set<string>();
  for (const item of contexts) {
    const name = consoleContextLabel(item);
    labels.set(item.key, name);
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  for (const [key, name] of labels) {
    if (duplicates.has(name)) labels.set(key, `${name} · ${key}`);
  }
  return labels;
}

/** Preserve the server's frame-tree order; keep departed contexts selectable afterwards. */
export function retainConsoleContexts(previous: ConsoleContext[], current: ConsoleContext[]) {
  const keys = new Set(current.map(context => context.key));
  return [...current, ...previous.filter(context => !keys.has(context.key))];
}

export function consoleContextTreeLabel(context: ConsoleContext, label: string) {
  const depth = Math.max(0, Math.min(context.depth ?? 0, 20));
  return `${'\u00a0\u00a0\u00a0'.repeat(depth)}${depth ? '↳ ' : ''}${label}`;
}
