import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { check, format, resolveConfig } from 'prettier';

const lint = new ESLint();

test('Flow lint checks TypeScript correctness and rejects unsafe Vue templates', async () => {
  const [typescript] = await lint.lintText('export function run() { debugger; }', {
    filePath: 'shared/flow-style-probe.ts',
  });
  assert.ok(typescript.messages.some((message) => message.ruleId === 'no-debugger'));
  const [vue] = await lint.lintText(
    '<script setup lang="ts">defineProps<{ html: string }>();</script>\n<template><div v-html="html"></div></template>',
    { filePath: 'src/components/FlowStyleProbe.vue' },
  );
  assert.ok(vue.messages.some((message) => message.ruleId === 'vue/no-v-html'));
  const [valid] = await lint.lintText(
    '<script setup lang="ts">defineProps<{ text: string }>();</script>\n<template><div>{{ text }}</div></template>',
    { filePath: 'src/components/FlowStyleProbe.vue' },
  );
  assert.deepEqual(valid.messages, []);
});

test('the formatter detects and repairs dense TypeScript and Vue within the rollout', async () => {
  for (const [filepath, source] of [
    ['shared/flow-style-probe.ts', 'export const value={a:1,b:"two"};'],
    [
      'src/components/FlowStyleProbe.vue',
      '<script setup lang="ts">const text="two";</script><template><div>{{text}}</div></template>',
    ],
  ]) {
    const options = { ...(await resolveConfig(filepath)), filepath };
    assert.equal(await check(source, options), false);
    const formatted = await format(source, options);
    assert.equal(await check(formatted, options), true);
    assert.equal(await format(formatted, options), formatted, 'formatting must be idempotent');
  }
});
