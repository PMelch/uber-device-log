import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { parseFlowBlueprint } from '../shared/flow-blueprints.js';
import { createFlowEngine } from '../shared/flow-engine.js';

const repository = fileURLToPath(new URL('../', import.meta.url));
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    assert.equal(entry.isSymbolicLink(), false, `Portable bundles must not depend on symlinks: ${entry.name}`);
    const path = join(directory, entry.name);
    result.push(...(entry.isDirectory() ? await files(path) : [path]));
  }
  return result;
}

test('flow authoring skill works as a copied folder without links to the viewer checkout', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'flow-skill-'));
  try {
    const root = join(temporary, 'app/.agents/skills/udl-semantic-flows');
    await cp(join(repository, 'skills/udl-semantic-flows'), root, { recursive: true });
    const skill = await readFile(join(root, 'SKILL.md'), 'utf8');
    const metadata = parse(skill.match(/^---\n([\s\S]*?)\n---/)![1]);
    assert.equal(metadata.name, 'udl-semantic-flows');
    assert.ok(metadata.description.length > 0 && metadata.description.length <= 1024);
    for (const file of await files(root)) {
      if (!file.endsWith('.md')) continue;
      const source = await readFile(file, 'utf8');
      assert.ok(!source.includes('/Users/pmelchart'), 'Skill must not embed host filesystem paths');
      for (const match of source.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const reference = match[1]!;
        if (/^[a-z]+:/i.test(reference) || reference.startsWith('#')) continue;
        const target = resolve(dirname(file), decodeURIComponent(reference.split('#')[0]!));
        assert.ok(target.startsWith(root + '/'), `Reference escapes portable skill: ${file} → ${reference}`);
        assert.ok((await stat(target)).isFile(), `Missing bundled resource: ${reference}`);
      }
    }
    const definitions = [];
    for (const filename of await readdir(join(root, 'assets/flows'))) {
      const parsed = parseFlowBlueprint(await readFile(join(root, 'assets/flows', filename), 'utf8'), filename);
      assert.deepEqual(parsed.diagnostics, []); definitions.push(parsed.blueprint!);
    }
    assert.ok(definitions.some(blueprint => blueprint.id === 'bank-transaction'));
    const bankEvents = (await readFile(join(root, 'assets/events/bank-transaction-events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    let clock = 0;
    const engine = createFlowEngine(() => clock);
    engine.setBlueprints(definitions, 'portable-skill');
    for (const event of bankEvents) {
      engine.ingest([{ timestamp: new Date(clock).toISOString(), message: JSON.stringify(event), source: { key: 'fixture', name: 'Fixture', platform: 'android', deviceId: 'fixture' } }]); clock += 100;
    }
    clock += 61_000; engine.tick();
    const outcomes = engine.getState().instances.map(instance => instance.outcome);
    assert.equal(outcomes.filter(value => value === 'completed').length, 2);
    assert.equal(outcomes.filter(value => value === 'failed').length, 3);
    assert.equal(outcomes.filter(value => value === 'cancelled').length, 1);
    assert.equal(outcomes.filter(value => value === 'timed_out').length, 1);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('portable flow references and fixtures stay in sync with the canonical contract', async () => {
  await promisify(execFile)(process.execPath, ['scripts/sync-flow-skill.mjs', '--check'], { cwd: repository });
});
