import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Materials } from '../src/materials.js';
import { Workbench } from '../src/service.js';
import { discoverMaterialConnections } from '../src/material-connections.js';

async function setup(t, execute) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'materials-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = { workspaceRoot: dir, materialSourcesPath: path.join(dir, 'sources.json') };
  await fs.writeFile(config.materialSourcesPath, JSON.stringify({ schemaVersion: 1, sources: [{ id: 'db', label: '测试数据库', kind: 'mcp', readOnly: true, tools: { search: 'mcp__test__search', read: 'mcp__test__read' } }] }));
  const tools = { schemas: () => ['mcp__test__search', 'mcp__test__read'].map(name => ({ name })), execute };
  return { dir, tools, materials: new Materials(new Workbench(config), tools) };
}
test('unconfigured database is empty and never falls back to mock records', async () => {
  const m = new Materials(new Workbench({}), { schemas: () => [] });
  assert.ok((await m.list()).every(s => s.kind === 'megmeet-official'));
  await assert.rejects(m.search({ sourceId: 'arbitrary', query: '' }), /配置/);
});
test('MCP search preserves true totals and cursor, and allows only configured tools', async t => {
  const calls = [];
  const { materials, tools } = await setup(t, async (name, args) => {
    calls.push([name, args]);
    return { structuredContent: { items: [{ id: 'manual', title: '手册' }], total: 327, nextCursor: args.cursor ? null : 'page-two' } };
  });
  assert.equal((await materials.list()).find(s => s.id === 'db').connected, true);
  assert.equal((await materials.search({ sourceId: 'db', query: '芯片', limit: 20 })).total, 327);
  assert.equal((await materials.search({ sourceId: 'db', query: '芯片', cursor: 'page-two' })).nextCursor, null);
  assert.deepEqual(calls[1], ['mcp__test__search', { query: '芯片', limit: 20, cursor: 'page-two' }]);
  await assert.rejects(materials.search({ sourceId: 'mcp__shell', query: '' }), /配置/);
  tools.schemas = () => [];
  assert.equal((await materials.list()).find(s => s.id === 'db').connected, false);
  await assert.rejects(materials.search({ sourceId: 'db', query: '' }), /尚未连接/);
});
test('MCP reads bind record identity and reject paths outside workspace', async t => {
  let value;
  const { materials, dir } = await setup(t, async () => ({ content: [{ type: 'text', text: JSON.stringify(value) }] }));
  const pdf = path.join(dir, 'manual.pdf'); await fs.writeFile(pdf, '%PDF-test');
  value = { id: 'manual', title: '手册', revision: 'rev2', filePath: pdf };
  const record = await materials.read({ sourceId: 'db', id: 'manual' });
  assert.equal(record.revision, 'rev2'); assert.equal(record.filePath, pdf);
  await assert.rejects(materials.read({ sourceId: 'db', id: 'different' }), /不同的记录/);
  value.filePath = path.join(dir, '..', 'outside.pdf'); await fs.writeFile(value.filePath, '%PDF');
  t.after(() => fs.rm(value.filePath, { force: true }));
  await assert.rejects(materials.read({ sourceId: 'db', id: 'manual' }), /超出/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(materials.search({ sourceId: 'db', query: '' }, controller.signal), { name: 'AbortError' });
});

test('user-added sources survive reload and report actual connection state', async t => {
  const { materials, dir, tools } = await setup(t, async () => ({ items: [{ id: 'one', title: '实际返回的手册' }], total: 1 }));
  materials.service.config.workDirectory = dir;
  const source = { label: '新资料库', readOnly: true, tools: { search: 'mcp__new__search', read: 'mcp__new__read' } };
  const saved = await materials.configure({ action: 'save-source', source });
  const reloaded = new Materials(materials.service, tools);
  assert.equal((await reloaded.list()).find(s => s.id === saved.id).connected, false);
  tools.schemas = () => Object.values(source.tools).map(name => ({ name }));
  assert.equal((await reloaded.list()).find(s => s.id === saved.id).connected, true);
  assert.equal((await reloaded.search({ sourceId: saved.id, query: '' })).items[0].title, '实际返回的手册');
  await reloaded.configure({ action: 'save-source', id: saved.id, source: { ...source, label: '已修改' } });
  assert.equal((await reloaded.list()).find(s => s.id === saved.id).label, '已修改');
  await reloaded.configure({ action: 'remove-source', id: saved.id });
  assert.equal((await reloaded.list()).some(s => s.id === saved.id), false);
  assert.equal((await reloaded.list()).some(s => s.id === 'db'), true);
});

test('source settings protect managed sources and serialize concurrent additions', async t => {
  const { materials, dir } = await setup(t);
  materials.service.config.workDirectory = dir;
  const source = { label: '只读库', readOnly: true, tools: { search: 'mcp__test__search', read: 'mcp__test__read' } };
  await assert.rejects(materials.configure({ action: 'remove-source', id: 'db' }), /插件配置管理/);
  await assert.rejects(materials.configure({ action: 'remove-source', id: 'megmeet-official' }), /插件配置管理/);
  await assert.rejects(materials.configure({ action: 'save-source', source: { ...source, readOnly: false } }), /只读 MCP/);
  await assert.rejects(materials.configure({ action: 'save-source', source: { ...source, tools: { search: 'shell', read: 'mcp__test__read' } } }), /只读 MCP/);
  const additions = await Promise.all([materials.configure({ action: 'save-source', source }), materials.configure({ action: 'save-source', source: { ...source, label: '第二个库' } })]);
  const rows = await materials.list();
  assert.ok(additions.every(s => rows.find(row => row.id === s.id)?.editable));
  assert.equal((await materials.settings()).canSave, true);
});

test('database picker only shows unambiguous compatible search/read pairs', () => {
  const search = { name: 'mcp__manuals__search', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } };
  const read = { name: 'mcp__manuals__read', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } };
  const unrelated = Array.from({ length: 233 }, (_, i) => ({ name: `mcp__eda__tool${i}`, parameters: { type: 'object' } }));
  assert.deepEqual(discoverMaterialConnections(unrelated), []);
  assert.equal(discoverMaterialConnections([...unrelated, search, read])[0].tools.read, read.name);
  assert.deepEqual(discoverMaterialConnections([search, read, { ...read, name: 'mcp__manuals__fetch' }]), []);
  assert.deepEqual(discoverMaterialConnections([search, { ...read, parameters: { ...read.parameters, required: ['id', 'sql'] } }]), []);
});
