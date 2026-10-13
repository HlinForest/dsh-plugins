import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../client/core.js', import.meta.url), 'utf8');
const apiFor = response => vm.runInNewContext(source.slice(source.indexOf('    async function api(')) + '; api', { fetch: async () => response });
test('missing engineering route reports backend mismatch, never a JSON syntax error', async () => {
  await assert.rejects(apiFor(new Response('not found', { status: 404 }))('engineering', { action: 'list' }), /接口.*404.*后端/);
});
test('authentication and structured business failures remain distinguishable', async () => {
  await assert.rejects(apiFor(new Response('unauthorized', { status: 401 }))('engineering', {}), /认证/);
  await assert.rejects(apiFor(Response.json({ ok: false, error: '请选择输入文件。' }, { status: 400 }))('engineering', {}), /请选择输入文件/);
  assert.equal(await apiFor(Response.json({ ok: true, value: 3 }))('status'), 3);
});
