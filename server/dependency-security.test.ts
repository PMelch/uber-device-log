import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const require = createRequire(import.meta.url);
test('Appium shell quoting rejects newline tokens after comments without executing a shell', () => {
  const fromAppium = createRequire(require.resolve('@appium/support'));
  const { quote } = fromAppium('shell-quote');
  assert.throws(() => quote(['echo', { comment: 'comment' }, 'first\nsecond']), TypeError);
});

for (const arrayHeaders of [false, true]) {
  test(`Appium redirects strip credentials across origins with ${arrayHeaders ? 'array' : 'object'} headers`, { timeout: 5000 }, async t => {
    const fromAppium = createRequire(require.resolve('appium-ios-device'));
    const fromAxios = createRequire(fromAppium.resolve('axios'));
    const { http } = fromAxios('follow-redirects');
    const destination = createServer((request, response) => response.end(JSON.stringify(request.headers)));
    const listen = async (server: Server) => {
      t.after(() => { server.closeAllConnections(); server.close(); });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    const target = await listen(destination);
    const redirector = createServer((_request, response) => {
      response.writeHead(302, { Location: target });
      response.end();
    });
    const source = await listen(redirector);
    const headers = {
      Authorization: 'Bearer test-only', Cookie: 'session=test-only',
      'Proxy-Authorization': 'Basic test-only', 'X-Api^Key': 'test-only',
      'X-Token|Secret': 'test-only', 'X-Public': 'keep',
    };
    const received = await new Promise<IncomingHttpHeaders>((resolve, reject) => {
      const request = http.get(source, {
        headers: arrayHeaders ? ['Host', new URL(source).host, ...Object.entries(headers).flat()] : headers,
        sensitiveHeaders: ['X-Api^Key', 'X-Token|Secret'],
      }, (response: import('node:http').IncomingMessage) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('error', reject);
        response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
      });
      request.on('error', reject);
      request.setTimeout(3000, () => request.destroy(new Error('Redirect test timed out')));
    });
    assert.equal(received['x-public'], 'keep');
    for (const name of Object.keys(headers).filter(name => name !== 'X-Public')) {
      assert.equal(received[name.toLowerCase()], undefined, `${name} must not reach the other origin`);
    }
  });
}
