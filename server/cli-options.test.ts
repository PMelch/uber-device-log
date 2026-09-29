import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCliOptions } from './cli-options.js';
test('CLI defaults, environment port and explicit override', () => {
  assert.deepEqual(parseCliOptions([], undefined), { port: 4310, help: false, version: false });
  assert.equal(parseCliOptions([], '4320').port, 4320);
  assert.equal(parseCliOptions(['--port', '4321'], 'invalid').port, 4321);
  assert.equal(parseCliOptions(['--port=4322']).port, 4322);
});
test('help and version do not need a valid runtime port', () => {
  assert.equal(parseCliOptions(['--help'], 'invalid').help, true);
  assert.equal(parseCliOptions(['-v']).version, true);
});
test('invalid ports and unknown arguments are rejected', () => {
  for (const args of [['--port'], ['--port','0'], ['--port','65536'], ['--port','1.5'], ['--port','12x'], ['--host','0.0.0.0'], ['surprise']]) {
    assert.throws(() => parseCliOptions(args));
  }
  assert.throws(() => parseCliOptions([], 'bad'));
});
