/** Resolve the Semantic Flow collection/tutorial and terminal setup links for a website build. */
export function websiteRepositoryLinks(html, ref) {
  if (typeof ref !== 'string' || !ref.trim()) throw new Error('A documentation ref is required.');
  const encodedRef = ref.trim().split('/').map(encodeURIComponent).join('/');
  return html.replace(
    /https:\/\/github\.com\/PMelch\/uber-device-log\/(tree|blob)\/main\/(?=blueprints(?:[\/"#])|tutorials\/semantic-flows\/|docs\/tui\.md(?:["#]))/g,
    (_match, kind) => `https://github.com/PMelch/uber-device-log/${kind}/${encodedRef}/`,
  );
}
