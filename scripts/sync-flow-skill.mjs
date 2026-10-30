// Keep the copyable skill self-contained without making a second hand-maintained DSL.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'skills/udl-semantic-flows');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Usage: node scripts/sync-flow-skill.mjs [--check]');
const read = path => readFile(resolve(root, path), 'utf8');
const hash = content => createHash('sha256').update(content).digest('hex');
const output = new Map();
function portableLinks(content) {
  return content.replaceAll('../test_flow_project/README.md', 'examples.md')
    .replaceAll('[interactive console emitter](../test_flow_project/loading-progress-demo.html)', 'message replay patterns described in [validation](validation.md)')
    .replaceAll('../test_flow_project/.udl/flows/', '../assets/flows/')
    .replaceAll('../test_flow_project/bank-transaction-events.jsonl', '../assets/events/bank-transaction-events.jsonl')
    .replaceAll('../test_flow_project/loading-progress-events.jsonl', '../assets/events/loading-progress-events.jsonl')
    .replaceAll('semantic-flows-agent-guide.md', 'authoring-guide.md')
    .replaceAll('semantic-flows-browser-tests.md', 'validation.md');
}
const format = await read('docs/flow-format.md');
output.set('references/flow-format.md', portableLinks(format.split('## Implementation and further reading')[0]) + `## Bundled resources\n\n- [Authoring guide](authoring-guide.md) for extracting flows from application code.\n- [Validation](validation.md) for editor, API and optional viewer-checkout checks.\n- [Examples](examples.md) for fictional YAML definitions and event fixtures.\n- [API](api.md#semantic-flows) for local draft validation and file operations.\n- [Contract fingerprint](contract.json) identifies the source contract used to generate this copy.\n`);
let guide = await read('docs/semantic-flows-agent-guide.md');
guide = guide.replace(/^Semantic Flows version 1 is implemented\..*$/m, 'Use the bundled format reference as the authoring contract. Its source fingerprint is recorded in [contract.json](contract.json). For actual runtime checks, use the viewer described in [validation.md](validation.md); a format version does not imply that every published viewer release supports every bundled feature.')
  .replace(/^For local programmatic validation,.*$/m, 'Use [validation.md](validation.md) for schema validation with a running local viewer or an optional viewer source checkout. The [bundled examples](examples.md) demonstrate fictional message shapes. Project selection never generates synthetic capture traffic by itself. Never claim engine or hardware validation when only schema checks were run.')
  .replace('Read `docs/semantic-flows-agent-guide.md` and the implemented Semantic Flows schema and validator.', 'Read this skill\'s bundled authoring guide and format reference, and use an available viewer validator.')
  .replace(/## Version 1 implementation references\n[\s\S]*?(?=## Author instance summaries)/, '## Bundled contract and validation\n\nThe full field contract is in [flow-format.md](flow-format.md). Matchers and extraction syntax are validated by the viewer, not by this documentation bundle. See [validation.md](validation.md) for validation availability and [examples.md](examples.md) for fictional fixtures. Keep sample definitions inactive in an application unless explicitly requested.\n\n')
  .replaceAll('`test_flow_project/.udl/flows/bank-transaction.yaml`', '[bank transaction example](../assets/flows/bank-transaction.yaml)');
output.set('references/authoring-guide.md', portableLinks(guide));
const api = await read('docs/api.md');
const access = api.slice(api.indexOf('## Local access'), api.indexOf('Examples below use'));
const flowApi = api.slice(api.indexOf('## Semantic Flows'), api.indexOf('## Limits and timeouts'));
output.set('references/api.md', '# Local Flow validation API\n\n' + portableLinks(access + flowApi).replace('[browser regression guide]', '[validation guide]'));
for (const filename of ['purchase.yaml', 'login.yaml', 'asset-download.yaml', 'bank-transaction.yaml', 'loading-progress.yaml']) {
  output.set(`assets/flows/${filename}`, await read(`test_flow_project/.udl/flows/${filename}`));
}
for (const filename of ['sample-events.jsonl', 'bank-transaction-events.jsonl', 'loading-progress-events.jsonl']) output.set(`assets/events/${filename}`, await read(`test_flow_project/${filename}`));
output.set('assets/config.yaml', await read('test_flow_project/.udl/config.yaml'));
output.set('LICENSE', await read('LICENSE'));
output.set('INSTALL.md', (await read('docs/flow-authoring-skill.md')).replaceAll('../skills/udl-semantic-flows/SKILL.md', 'SKILL.md'));
const contractSources = ['shared/flow-types.ts', 'shared/flow-blueprints.ts', 'shared/flow-engine.ts', 'shared/flow-presentation.ts'];
const sourceFingerprints = Object.fromEntries(await Promise.all(contractSources.map(async path => [path, hash(await read(path))])));
const packageMetadata = JSON.parse(await read('package.json'));
output.set('references/contract.json', JSON.stringify({
  formatVersion: 1,
  viewerPackageVersion: packageMetadata.version,
  compatibility: 'Snapshot of the source contract, including unreleased changes. This package version is provenance, not a minimum supported release. Validate with a viewer that implements these features.',
  contractDigest: hash(JSON.stringify(sourceFingerprints)),
  sourceFingerprints,
  resources: Object.fromEntries([...output].map(([path, content]) => [path, hash(content)])),
}, null, 2) + '\n');
const stale = [];
for (const [path, content] of output) {
  const destination = resolve(directory, path);
  if (check) {
    let current; try { current = await readFile(destination, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current !== content) stale.push(path);
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}
if (stale.length) { console.error('Portable flow skill is stale. Run npm run skill:sync.\n' + stale.join('\n')); process.exitCode = 1; }
else console.log(check ? 'Portable flow skill matches the canonical contract.' : `Updated ${output.size} portable flow skill resources.`);
