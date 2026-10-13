import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { within, readLimited, json } from '../engineering/io.js';

const hash = data => createHash('sha256').update(data).digest('hex');
export async function prepareNative(service, args, signal) {
  const sources = {};
  for (const [key, ext] of [['schematic', '.schdoc'], ['pcb', '.pcbdoc'], ['nativeProject', '.prjpcb']]) {
    if (key === 'nativeProject' && !args[key]) continue;
    const file = await within(service.config.workspaceRoot, args[key]);
    if (path.extname(file).toLowerCase() !== ext) throw new Error('请选择原始 ' + ext + ' 文件。');
    const data = await readLimited(file);
    sources[key] = { file, data, sha256: hash(data) };
  }
  const root = path.join(service.config.workDirectory, 'native-intake', randomUUID());
  await fs.mkdir(path.join(root, '00_native'), { recursive: true });
  const names = new Set(), relative = {}, origin = {};
  for (const [key, source] of Object.entries(sources)) {
    const name = path.basename(source.file);
    if (names.has(name.toLowerCase())) throw new Error('原文件名重复，请检查来源。');
    names.add(name.toLowerCase()); relative[key] = '00_native/' + name;
    await fs.writeFile(path.join(root, relative[key]), source.data, { flag: 'wx' });
    origin[relative[key]] = { sourcePath: source.file, sha256: source.sha256 };
  }
  const request = path.join(root, 'request.json');
  await json(request, { root, sources: relative });
  await service.command(service.config.kicadPython, [fileURLToPath(new URL('./native.py', import.meta.url)), request], path.join(root, 'execution.json'), signal);
  const extraction = JSON.parse(await fs.readFile(path.join(root, 'extraction.json'), 'utf8'));
  // Original project documents are inspected, never followed automatically into other directories.
  if (sources.nativeProject) {
    const bytes = sources.nativeProject.data;
    let text;
    if (bytes[0] === 255 && bytes[1] === 254) text = bytes.toString('utf16le');
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = new TextDecoder('gb18030').decode(bytes); } }
    const docs = [...text.matchAll(/^DocumentPath\s*=\s*(.+)$/gmi)].map(m => m[1].trim()).filter(p => /\.(schdoc|pcbdoc)$/i.test(p));
    extraction.projectDocuments = docs;
    const declared = docs.map(p => path.win32.basename(p).toLowerCase());
    const chosen = [sources.schematic.file, sources.pcb.file].map(p => path.basename(p).toLowerCase());
    if (declared.length !== 2 || new Set(declared).size !== 2 || chosen.some(n => !declared.includes(n))) {
      extraction.eligible = false;
      extraction.issues.push('PrjPcb 文档列表与所选单页原理图/PCB 不一致；本适配器不合并多页或自动选取版本。');
    }
  }
  for (const source of Object.values(sources)) {
    if (hash(await readLimited(source.file)) !== source.sha256) throw new Error('提取期间原文件发生变化，请重新读取。记录：' + root);
  }
  await json(path.join(root, 'extraction.json'), extraction);
  if (!extraction.eligible) throw new Error('资料已保留，但当前适配器无法完整解释：' + extraction.issues.slice(0, 4).join('；') + '。提取记录：' + root);
  const files = [];
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error('提取证据不能包含符号链接。');
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await walk(file);
      else {
        const relativePath = path.relative(root, file).replaceAll('\\', '/'), bytes = await readLimited(file);
        files.push({ path: relativePath, bytes: bytes.length, sha256: hash(bytes), ...(origin[relativePath] ? { sourcePath: origin[relativePath].sourcePath } : {}) });
      }
    }
  }
  for (const dir of ['00_native', '02_extracted', '04_assets']) await walk(path.join(root, dir));
  const manifest = path.join(root, 'manifest.json');
  await json(manifest, { format: 'harness-native-input/1', project: String(args.label || path.basename(sources.schematic.file, path.extname(sources.schematic.file))), readiness: 'PARTIAL', extraction,
    selection: 'Explicit local native files only; no history, reconstructed designs or conversion scripts.', files: files.sort((a, b) => a.path.localeCompare(b.path)) });
  const run = await service.create({ manifest });
  run.intake = { directory: root, extraction, originalFilesUnchanged: true };
  await service.save(run);
  return service.present(run);
}
