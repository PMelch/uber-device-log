import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { streamLogs } from './stream';
import type { OpenLogs, Stop } from './devices';
import type { Device } from '../shared/types';

class Response extends EventEmitter {
  destroyed = false;
  frames: string[] = [];
  writable = true;
  writeHead() {}
  flushHeaders() {}
  write(value: string) { this.frames.push(value); return this.writable; }
  end() { this.destroyed = true; this.emit('close'); }
  asHttp() { return this as unknown as ServerResponse; }
}
const device: Device = { id: 'test', name: 'Test phone', platform: 'android', state: 'connected' };

test('closing a browser stops its collector exactly once', async () => {
  const response = new Response();
  let stops = 0;
  const stop = streamLogs(response.asHttp(), device, async () => () => { stops++; });
  await delay(0);
  response.end();
  stop();
  assert.equal(stops, 1);
});

test('switching devices while a collector opens still closes the late collector', async () => {
  const response = new Response();
  let resolve!: (stop: Stop) => void;
  let stops = 0;
  const stop = streamLogs(response.asHttp(), device, () => new Promise(done => { resolve = done; }));
  stop();
  resolve(() => { stops++; });
  await delay(0);
  assert.equal(stops, 1);
  assert.equal(response.frames.length, 0);
});

test('collector failures are delivered to the viewer and end the connection', async () => {
  const response = new Response();
  streamLogs(response.asHttp(), device, async () => { throw new Error('Device not trusted'); });
  await delay(0);
  assert.match(response.frames.join(''), /event: stopped/);
  const failure = JSON.parse(response.frames.find(frame => frame.startsWith('event: stopped'))!.split('\n')[1].slice(6));
  assert.equal(failure.code, 'streamCannotRead');
  assert.equal(failure.params.detail, 'Device not trusted');
  assert.match(failure.message, /Device not trusted/);
  assert.equal(response.destroyed, true);
});

test('log text is encoded safely and old collectors cannot send after closing', async () => {
  const response = new Response();
  let emit!: Parameters<OpenLogs>[1];
  const stop = streamLogs(response.asHttp(), device, async (_device, onMessage) => {
    emit = onMessage;
    return () => {};
  });
  try {
    await delay(0);
    emit({ timestamp: 'now', message: 'first\n\nevent: stopped\n<script>alert(1)</script>' });
    await delay(120);
    const frame = response.frames.find(value => value.startsWith('event: logs'))!;
    assert.equal(frame.split('\n').length, 4);
    assert.equal(JSON.parse(frame.split('\n')[1].slice(6))[0].message, 'first\n\nevent: stopped\n<script>alert(1)</script>');
    stop();
    const count = response.frames.length;
    emit({ timestamp: 'later', message: 'stale' });
    await delay(120);
    assert.equal(response.frames.length, count);
  } finally { stop(); }
});

test('slow browsers bound the queue and are told when messages were skipped', async () => {
  const response = new Response();
  response.writable = false;
  let emit!: Parameters<OpenLogs>[1];
  const stop = streamLogs(response.asHttp(), device, async (_device, onMessage) => {
    emit = onMessage;
    return () => {};
  });
  try {
    await delay(0);
    for (let i = 0; i < 1200; i++) emit({ timestamp: 'now', message: String(i) });
    await delay(120);
    assert.equal(response.frames.filter(frame => frame.startsWith('event: logs')).length, 0);
    response.writable = true;
    response.emit('drain');
    await delay(120);
    const skipped = response.frames.filter(frame => frame.startsWith('event: status')).map(frame => JSON.parse(frame.split('\n')[1].slice(6))).find(event => event.code === 'streamSkipped');
    assert.equal(skipped.params.count, 200);
    assert.match(skipped.message, /200/);
    const frame = response.frames.find(value => value.startsWith('event: logs'))!;
    const messages = JSON.parse(frame.split('\n')[1].slice(6));
    assert.equal(messages.length, 100);
    assert.equal(messages[0].message, '200');
  } finally { stop(); }
});
