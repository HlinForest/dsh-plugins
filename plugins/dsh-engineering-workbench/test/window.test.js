import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WorkbenchWindow } from '../src/window.js';

async function setup(t, launch) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-window-'));
  const calls = [];
  const window = new WorkbenchWindow({ workDirectory: dir }, [{ path: '/api/engineering-workbench/status', methods: ['GET'], fetch: async () => { calls.push('status'); return Response.json({ ok: true, value: { tasks: [] } }); } }], launch);
  t.after(async () => { await window.close(); assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, window, calls };
}
test('independent server requires its own cookie; rejects cross-site and non-workbench routes', async t => {
  const { window, calls } = await setup(t);
  const origin = await window.start(), url = origin + '/api/engineering-workbench/status';
  assert.equal((await fetch(url)).status, 401);
  const headers = { cookie: window.cookieName + '=' + window.key };
  assert.equal((await fetch(url, { headers: { cookie: window.cookieName + '=wrong' } })).status, 401);
  assert.equal((await fetch(url, { headers: { ...headers, origin: 'https://example.com' } })).status, 403);
  const wrongHost = await new Promise((resolve, reject) => {
    http.get(url, { headers: { ...headers, host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(origin + '/api/models', { headers })).status, 404);
  assert.equal((await fetch(origin + '/api/engineering-workbench/open-window', { method: 'POST', headers })).status, 404);
  assert.deepEqual(await (await fetch(url, { headers })).json(), { ok: true, value: { tasks: [] } });
  assert.equal(calls.length, 1);
  assert.equal((await fetch(origin + '/api/engineering-workbench/window-heartbeat', { headers })).status, 200);
  await window.close();
  await assert.rejects(fetch(url));
});
test('absent desktop runtime uses the authenticated web page without changing work directories', async t => {
  const { window } = await setup(t, () => { throw new Error('must not launch'); });
  assert.deepEqual(await window.open(), { mode: 'web', url: '/api/engineering-workbench/page' });
  assert.equal(window.server, undefined);
});
test('concurrent opens launch one window, later opens activate that same profile', { skip: process.platform !== 'win32' }, async t => {
  const launches = [];
  const { dir, window } = await setup(t, async options => { launches.push(options); await new Promise(r => setTimeout(r, 40)); });
  await fs.mkdir(path.join(dir, 'desktop-runtime'));
  await fs.writeFile(path.join(dir, 'desktop-runtime/electron.exe'), 'test stub, never executed');
  const results = await Promise.all([window.open(), window.open(), window.open()]);
  assert.ok(results.every(r => r.mode === 'desktop'));
  assert.equal(launches.length, 1);
  await window.open(); assert.equal(launches.length, 2);
  assert.equal(launches[0].directory, launches[1].directory);
  const state = JSON.parse(await fs.readFile(launches[0].connectionFile, 'utf8'));
  assert.equal(state.key.length, 64);
  assert.equal('model' in state, false);
});
