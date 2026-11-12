import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serializeLogExport } from '../shared/log-export';

test('main-log export preserves structured postMessage data and source identity', () => {
  const postMessage = { id: 1, time: 1760000000000, receiver: 'frame', source: 'top', origin: 'https://example.com', data: '{"answer":42}', receiverContext: { key: 'frame', name: 'checkout', url: 'https://example.com/checkout', frame: 'child', top: false } };
  const source = { key: 'messages', name: 'postMessage', platform: 'android' as const, deviceId: 'device', kind: 'postMessage' as const };
  const row = { timestamp: new Date(postMessage.time).toISOString(), message: postMessage.data, source, postMessage };
  const result = JSON.parse(serializeLogExport([row], { id: 'device', name: 'Device', platform: 'android', state: 'connected' }, 'json').text);
  assert.deepEqual(result.entries[0].postMessage, postMessage);
  assert.equal(result.sources[0].kind, 'postMessage');
});
