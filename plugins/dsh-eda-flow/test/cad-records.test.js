import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { runLayoutPython, libraryConfig } from '../src/controlled-layout.js';
import { writeJSON, readJSON } from '../src/io.js';
import { DatabaseSync } from 'node:sqlite';
import { routes } from '../src/http.js';

test('CAD library lookup survives protected JSON export at the actual Node to Python boundary', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-protected-cad-'));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, kicadPython: 'D:/anaconda/python.exe', kicadCli: 'D:/Kicad/bin/kicad-cli.exe' });
  t.after(async () => { await flow.close(); await fs.rm(root, { recursive: true, force: true }); });
  const rename = fs.rename.bind(fs);
  let protectedCount = 0;
  t.mock.method(fs, 'rename', async (from, to) => {
    await rename(from, to);
    if (String(to).startsWith(root) && String(to).endsWith('.json')) {
      await fs.writeFile(to, '%TSD-Header-test-export'); protectedCount++;
    }
  });
  const result = await runLayoutPython(flow, { engine: 'native-kicad', operation: 'lookup', ...libraryConfig(flow), kind: 'symbol', query: 'Device:R' }, root);
  assert(result);
  assert(protectedCount > 0);
  assert.equal(await fs.readFile(path.join(root, 'request.json'), 'utf8'), '%TSD-Header-test-export');
});

test('protected delivery export remains viewable and corrupt database records fail closed', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-record-view-'));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root });
  t.after(async () => { await flow.close(); await fs.rm(root, { recursive: true, force: true }); });
  const p = await flow.create({ label: 'records', designMode: 'new-design' });
  const output = path.join(flow.dir(p.id), 'steps', '1', 'test');
  p.stages[0].output = output; await flow.save(p);
  const file = path.join(output, 'result.json');
  const value = { summary: '实际检查结果', errors: 0 };
  await writeJSON(file, value);
  await fs.writeFile(file, '%TSD-Header-test-export');
  const route = routes(flow).find(r => r.name === 'asset');
  const response = await route.run(new Request('http://localhost/asset?' + new URLSearchParams({ projectId: p.id, stage: '1', path: 'result.json' })));
  assert.deepEqual(await response.json(), value);
  const db = new DatabaseSync(path.join(output, '.eda-records.sqlite'));
  db.prepare('UPDATE records SET body=? WHERE name=?').run('{"errors":999}', 'result.json'); db.close();
  await assert.rejects(readJSON(file), /校验失败/);
});
