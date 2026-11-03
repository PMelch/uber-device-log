import test from 'node:test';
import assert from 'node:assert/strict';
import { blueprintPriorityDraft, setBlueprintPriority } from '../src/flow-priority.js';
test('priority selector preserves YAML comments and does not repair malformed drafts', () => {
  const source = '# project evidence\nversion: 1\npriority: 2 # notable\nname: "Keep quotes"\n';
  assert.deepEqual(blueprintPriorityDraft(source), { value: 2, editable: true });
  const updated = setBlueprintPriority(source, 5)!;
  assert.match(updated, /priority: 5 # notable/);
  assert.match(updated, /# project evidence/);
  assert.match(updated, /name: "Keep quotes"/);
  assert.equal(blueprintPriorityDraft('version: 1\n').value, 3);
  assert.match(setBlueprintPriority('version: 1\n', 1)!, /priority: 1/);
  for (const broken of ['[bad', '[]', '', 'priority: 0', 'priority: "1"', 'priority: 1\npriority: 2']) {
    assert.equal(blueprintPriorityDraft(broken).editable, false, broken);
    assert.equal(setBlueprintPriority(broken, 2), undefined, broken);
  }
  assert.equal(setBlueprintPriority(source, 6), undefined);
});
