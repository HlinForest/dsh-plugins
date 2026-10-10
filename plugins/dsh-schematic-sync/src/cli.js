#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { SyncService } from './service.js';

async function main() {
  const { values: v, positionals: p } = parseArgs({ allowPositionals: true, options: {
    config: { type: 'string' }, current: { type: 'string' }, target: { type: 'string' }, text: { type: 'string' },
    task: { type: 'string' }, which: { type: 'string' }, revision: { type: 'string' }, token: { type: 'string' },
    json: { type: 'string' }, page: { type: 'string' }, interpret: { type: 'boolean' },
  } });
  if (!v.config) throw new Error('Usage: schematic-sync <begin|inspect|read-target|define|compare|prepare|verify|apply|rollback> --config config.json [options]');
  const service = new SyncService(JSON.parse(await readFile(v.config, 'utf8')));
  const data = v.json ? JSON.parse(await readFile(v.json, 'utf8')) : undefined;
  const commands = {
    begin: () => service.begin({ currentPath: v.current, targetPath: v.target, targetText: v.text }),
    inspect: () => service.inspect(v.task, v.which),
    'read-target': () => service.reference(v.task, Number(v.page ?? 1), v.interpret),
    define: () => service.define(v.task, v.revision, data),
    compare: () => service.compare(v.task, v.which),
    prepare: () => service.prepare(v.task, v.revision, data),
    verify: () => service.verify(v.task),
    apply: () => service.apply(v.task, v.token),
    rollback: () => service.rollback(v.task),
  };
  if (!commands[p[0]]) throw new Error('Unknown command');
  console.log(JSON.stringify(await commands[p[0]](), null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
