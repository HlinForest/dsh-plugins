#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import { resolve, join, dirname, basename } from 'node:path';
import { mkdir, mkdtemp, writeFile, rename, readFile } from 'node:fs/promises';
import { validateContext } from '../src/validation.js';

async function main() {
  const { values } = parseArgs({ options: {
    cli: { type: 'string', default: 'kicad-cli' }, schematic: { type: 'string' }, pcb: { type: 'string' },
    out: { type: 'string' }, context: { type: 'string' },
  } });
  if (!values.schematic || !values.out) throw new Error('用法: node scripts/export-kicad.js --schematic board.kicad_sch [--pcb board.kicad_pcb] --out project.json [--context context.json] [--cli kicad-cli.exe]');
  const output = resolve(values.out), base = dirname(output);
  const context = values.context ? JSON.parse(await readFile(resolve(values.context), 'utf8')) : {};
  validateContext(context);
  await mkdir(base, { recursive: true });
  const generation = await mkdtemp(join(base, 'kicad-snapshot-'));
  const run = promisify(execFile), options = { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 };
  await run(values.cli, ['sch', 'export', 'netlist', '--format', 'kicadxml', '-o', join(generation, 'netlist.xml'), resolve(values.schematic)], options);
  if (values.pcb) await run(values.cli, ['pcb', 'export', 'pos', '--format', 'csv', '--units', 'mm', '--side', 'both', '-o', join(generation, 'positions.csv'), resolve(values.pcb)], options);
  const manifest = { schemaVersion: 1, project: basename(values.schematic, '.kicad_sch'), format: 'kicad-xml',
    netlistPath: `${basename(generation)}/netlist.xml`, ...(values.pcb ? { positionsPath: `${basename(generation)}/positions.csv` } : {}), context };
  const temp = join(generation, 'project.tmp');
  await writeFile(temp, JSON.stringify(manifest, null, 2) + '\n');
  await rename(temp, output);
  console.log(`已导出快照：${output}。旧快照保留；导出后请执行 pcb-review review。`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
