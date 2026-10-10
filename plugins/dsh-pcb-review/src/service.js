import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseKiCad, parseProtel, applyPositions } from './adapters.js';
import { review, digest, toMarkdown } from './engine.js';
import { object, string, enumeration, validateContext } from './validation.js';

export async function readLimited(path, signal) {
  signal?.throwIfAborted();
  const before = await stat(path);
  if (!before.isFile() || before.size > 20 * 1024 * 1024) throw new Error('输入必须是最多 20 MiB 的文件');
  const bytes = await readFile(path, { signal });
  if (bytes.length > 20 * 1024 * 1024) throw new Error('文件读取时超出大小限制');
  const after = await stat(path);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('文件仍在更新，请稍后重新评审');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw new Error('输入必须使用 UTF-8 编码，请先转换 AD 导出文件的编码'); }
  return { text, hash: digest(bytes), path, mtimeMs: after.mtimeMs, size: after.size };
}
export async function loadProject(projectFile, signal) {
  if (!projectFile || !isAbsolute(projectFile)) throw new Error('请由管理员配置 projectFile 绝对路径');
  const manifest = await readLimited(projectFile, signal), config = JSON.parse(manifest.text);
  object(config, 'project', ['schemaVersion', 'project', 'format', 'netlistPath', 'positionsPath', 'context']);
  if (config.schemaVersion !== 1) throw new Error('project.schemaVersion 必须为 1');
  string(config.project, 'project'); enumeration(config.format, ['kicad-xml', 'altium-protel', 'snapshot-json'], 'format');
  string(config.netlistPath, 'netlistPath');
  if (config.positionsPath !== undefined) string(config.positionsPath, 'positionsPath');
  validateContext(config.context ?? {});
  const netlist = await readLimited(resolve(dirname(projectFile), config.netlistPath), signal);
  const board = config.format === 'kicad-xml' ? parseKiCad(netlist.text, config.project) : config.format === 'altium-protel' ? parseProtel(netlist.text, config.project) : JSON.parse(netlist.text);
  board.project = config.project;
  const inputs = [manifest, netlist];
  if (config.positionsPath) {
    const positions = await readLimited(resolve(dirname(projectFile), config.positionsPath), signal);
    applyPositions(board, positions.text); inputs.push(positions);
  }
  // Detect replacement or edits to any earlier input while collecting the other inputs.
  for (const input of inputs) {
    const current = await stat(input.path);
    if (current.size !== input.size || current.mtimeMs !== input.mtimeMs) throw new Error('评审输入发生变化，请重新读取');
  }
  const result = review(board, config.context ?? {});
  result.revision = digest(inputs.map(i => i.hash));
  result.inputs = inputs.map(({ path, hash, mtimeMs }) => ({ path, sha256: hash, modifiedAt: new Date(mtimeMs).toISOString() }));
  result.notes.push('评审对象是已导出的快照；请核对导出时间和 EDA 当前装配版本。未保存或未重新导出的设计不在本次检查范围。');
  return { board, config, report: result };
}
export async function exportReport(report, directory, signal) {
  signal?.throwIfAborted();
  if (!directory || !isAbsolute(directory)) throw new Error('请由管理员配置 reportDirectory 绝对路径');
  await mkdir(directory, { recursive: true });
  const stem = `pcb-review-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const json = join(directory, `${stem}.json`), markdown = join(directory, `${stem}.md`);
  await writeFile(json, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', signal });
  await writeFile(markdown, toMarkdown(report), { flag: 'wx', signal });
  return { json, markdown, revision: report.revision };
}
