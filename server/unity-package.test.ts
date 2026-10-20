import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const file = (path: string) => readFileSync(new URL('../unity-package/' + path, import.meta.url), 'utf8');
// Source contracts only: these do not substitute for compiling/running in Unity.
test('Unity package is local-installable and Editor-only', () => {
  const pkg = JSON.parse(file('package.json'));
  assert.equal(pkg.unity, '2021.3');
  assert.deepEqual(JSON.parse(file('Editor/UberDeviceLog.Editor.asmdef')).includePlatforms, ['Editor']);
  assert.match(file('README.md'), /Add package from disk/);
});
test('transport is loopback-only, bounded and uses the agreed wire contract', () => {
  const source = file('Editor/UnityLogTransport.cs');
  for (const fragment of ['http://127.0.0.1:', 'QueueLimit = 1000', 'BatchLimit = 50', 'MaxPayloadBytes = 255 * 1024', 'HeartbeatSeconds = 2', 'version = 1', '/api/unity/pair', '/api/unity/batch', 'Authorization', 'Bearer ', 'projectId', 'instanceId', 'stackTrace', 'dropped', 'redirectLimit = 0', 'timeout = 2']) assert.ok(source.includes(fragment), fragment);
  assert.match(source, /Encoding.UTF8.GetByteCount/);
  assert.ok(source.includes('lock (Gate)'));
  assert.ok(source.includes(String.raw`@"\Ahttp://127\.0\.0\.1:[0-9]{1,5}\z"`));
  assert.ok(source.includes('port > 0 && port <= 65535'));
  assert.ok(source.includes('Math.Max(started + HeartbeatSeconds'));
  assert.ok(source.includes('else AddDropped(failedCount)'));
  assert.match(source, /LogType.Exception/);
  assert.doesNotMatch(source, /EditorPrefs|Debug.Log|HttpClient|Process.Start/);
});
test('transport survives reload and removes callbacks', () => {
  const source = file('Editor/UnityLogTransport.cs');
  for (const fragment of ['SessionState', 'Guid.NewGuid()', 'Application.logMessageReceivedThreaded +=', 'Application.logMessageReceivedThreaded -=', 'AssemblyReloadEvents.beforeAssemblyReload', 'EditorApplication.quitting', 'request.Abort()', 'request.Dispose()', 'failedCount', 'Math.Min(8', 'DateTime.UtcNow']) assert.ok(source.includes(fragment), fragment);
});
test('window provides explicit pair, connect, disconnect and forget actions', () => {
  const source = file('Editor/UnityLogWindow.cs');
  for (const fragment of ['Tools/Über Device Log', 'Project ID', 'Pairing code', 'Pair', 'Connect', 'Disconnect', 'Forget pairing', '120 seconds']) assert.ok(source.includes(fragment), fragment);
});

test('Editor persists pairing privately across process restarts',()=>{
 const source=file('Editor/UnityLogTransport.cs');
 for(const fragment of ['LocalApplicationData','SHA256','SaveCredentials','LoadCredentials','File.Delete','[a-f0-9]{64}']) assert.ok(source.includes(fragment),fragment);
});
