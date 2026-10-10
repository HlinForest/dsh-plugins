import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hash } from './model.js';
import { run, json, readLimited, version, within } from './io.js';
import { readKiCad, nativeCheck, boardInventory } from './kicad.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const referenceExt = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];
export const editableExt = ['.kicad_sch', '.schdoc', '.prjpcb'];
export async function python(config, worker, input, directory, signal) {
  const request = path.join(directory, `request-${randomUUID()}.json`); await json(request, input);
  try { return JSON.parse(await run(config.engineeringPython, [path.join(here, worker), request], signal)); }
  finally { await fs.rm(request, { force: true }); }
}
export async function snapshot(source, dest, root) {
  source = await within(root, source); await fs.mkdir(dest, { recursive: true });
  const base = path.dirname(source), manifest = [], seen = new Set();
  async function copy(file) {
    file = await within(base, file); const rel = path.relative(base, file);
    if (seen.has(rel)) return; seen.add(rel);
    if (seen.size > 256) throw new Error('工程包含过多文件。');
    const content = await readLimited(file), output = path.join(dest, rel); await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, content);
    manifest.push({ relative: rel, source: file, hash: hash(content) });
    if (path.extname(file).toLowerCase() === '.kicad_sch') {
      const { inventory } = await import('./kicad.js');
      for (const sheet of inventory(content.toString('utf8'), rel).sheets) await copy(path.resolve(path.dirname(file), sheet.file));
    }
    if (path.extname(file).toLowerCase() === '.prjpcb') {
      let ini;
      if (content[0] === 255 && content[1] === 254) ini = content.toString('utf16le');
      else { try { ini = new TextDecoder('utf-8', { fatal: true }).decode(content); } catch { ini = new TextDecoder('gb18030').decode(content); } }
      for (const m of ini.matchAll(/^DocumentPath=(.+)$/gmi)) {
        const name = m[1].trim(); if (/\.(schdoc|pcbdoc|schlib)$/i.test(name)) await copy(path.resolve(path.dirname(file), name));
      }
    }
    if (['sym-lib-table', 'fp-lib-table'].includes(path.basename(file))) {
      const { parse, nodes, value } = await import('./sexpr.js');
      for (const lib of nodes(parse(content.toString('utf8')), 'lib')) {
        const uri = value(lib, 'uri');
        if (!uri?.startsWith('${KIPRJMOD}/')) continue;
        const local = path.resolve(base, uri.slice('${KIPRJMOD}/'.length));
        const stat = await fs.stat(local);
        if (stat.isDirectory()) for (const entry of await fs.readdir(local)) { if (entry.endsWith('.kicad_mod')) await copy(path.join(local, entry)); }
        else await copy(local);
      }
    }
  }
  await copy(source);
  for (const name of [path.basename(source).replace(/\.kicad_(sch|pcb)$/i, '.kicad_pro'), 'sym-lib-table', 'fp-lib-table']) {
    const file = path.join(base, name); if (file === source) continue;
    try { await fs.access(file); } catch { continue; } await copy(file);
  }
  return { file: path.join(dest, path.basename(source)), source, manifest, version: hash(manifest.map(m => [m.relative, m.hash])) };
}
export async function checkManifest(snap, useSource = false) {
  for (const m of snap.manifest) if (await version(useSource ? m.source : path.join(path.dirname(snap.file), m.relative)) !== m.hash) throw new Error('输入文件已经变化，原检查和保存确认已失效。');
}
export async function readDesign(file, directory, config, signal, page = 1) {
  await fs.mkdir(directory, { recursive: true }); const ext = path.extname(file).toLowerCase(); let data;
  if (ext === '.kicad_sch') data = await readKiCad(file, directory, config, signal);
  else if (['.schdoc', '.prjpcb', '.pcbdoc'].includes(ext)) data = await python(config, 'altium.py', { action: 'read', file, output: directory }, directory, signal);
  else if (ext === '.kicad_pcb') {
    const svg = path.join(directory, 'board.svg');
    await run(config.kicadCli, ['pcb', 'export', 'svg', '--layers', 'F.Cu,B.Cu,F.SilkS,B.SilkS,Edge.Cuts', '--mode-single', '--page-size-mode', '2', '--exclude-drawing-sheet', '-o', svg, file], signal);
    const content = await fs.readFile(svg, 'utf8');
    data = { format: 'kicad-pcb', ...boardInventory((await readLimited(file)).toString('utf8'), path.basename(file)), objects: [], documents: [{ id: path.basename(file), file, instances: 1 }], previews: [{ file: svg, width: Number(content.match(/width="([\d.]+)mm"/)?.[1]) || 297, height: Number(content.match(/height="([\d.]+)mm"/)?.[1]) || 210 }], coverage: { connectivity: 'pcb-pad-net-assignment', geometry: 'native-drc' } };
  } else if (referenceExt.includes(ext)) {
    const preview = await python(config, 'reference.py', { file, output: directory, page }, directory, signal);
    data = { format: 'reference', components: [], nets: [], objects: [], documents: [{ id: path.basename(file), file, instances: 1 }], previews: [{ ...preview, file: preview.image }], text: preview.text, pages: preview.pages, page: preview.page, coverage: { connectivity: 'partial', recognition: 'not_performed' } };
  } else throw new Error('请选择 PDF、图片、KiCad 或 AD 原生工程。');
  data.version = await version(file); data.file = file; return data;
}
export async function checkDesign(file, directory, config, signal, parity) {
  if (/\.kicad_(sch|pcb)$/i.test(file)) return nativeCheck(file, directory, config, signal, parity);
  return { status: 'not_performed', engine: { name: 'Altium Designer', version: null }, violations: [], reason: '尚未取得此候选版本的 AD 25/26 原生检查结果。离线库读取不等于原生验证。' };
}
export async function happy(file, directory, config, signal) {
  if (!config.happyRoot) return { status: 'not_performed', reason: '尚未配置固定版本的扩展检查。' };
  const pins = JSON.parse(await fs.readFile(path.join(here, 'pins.json'), 'utf8'));
  const commit = (await run('git', ['-C', config.happyRoot, 'rev-parse', 'HEAD'], signal)).trim();
  if (commit !== pins['kicad-happy'].commit || (await run('git', ['-C', config.happyRoot, 'status', '--porcelain', '--untracked-files=no'], signal)).trim()) throw new Error('扩展检查版本或源码发生变化，请恢复固定版本。');
  const out = path.join(directory, 'happy.json');
  const pcb = /\.kicad_pcb$/i.test(file);
  if (!/\.kicad_(sch|pcb)$/i.test(file)) return { status: 'not_applicable', reason: '上游解析器依赖 KiCad；AD 使用共用规则，不伪装为 KiCad 原生结果。' };
  await run(config.engineeringPython, [path.join(config.happyRoot, 'skills/kicad/scripts', pcb ? 'analyze_pcb.py' : 'analyze_schematic.py'), file, '--output', out, '--only-deterministic'], signal);
  const result = JSON.parse(await fs.readFile(out, 'utf8'));
  const suppressed = [], findings = [];
  const allowed = /^(DC-DET|VD-DET|RC-DET|PU-|VM-|LED-|CS-|PWR-)/;
  for (const finding of result.findings || []) {
    if (!pcb && !allowed.test(finding.rule_id || '')) { suppressed.push({ rule: finding.rule_id, reason: '不在本轮启用的规则范围。' }); continue; }
    const refs = finding.components || [];
    const unfitted = refs.filter(ref => (result.components || []).some(c => c.reference === ref && c.dnp === true));
    if (unfitted.length) { suppressed.push({ rule: finding.rule_id, components: unfitted, reason: '上游结果使用了未装配器件，不作为实际电路检查结论。' }); continue; }
    findings.push({ ...finding, status: 'unknown', verification: 'suggestion', reason: '确定性提取建议；需结合原生对象、器件证据和适用工况复核。' });
  }
  return { status: 'suggestions', engine: { name: 'kicad-happy', version: commit }, findings, suppressed, coverage: result.trust_summary, report: out,
    validatedExamples: ['VD-DET: 10k/20k divider', 'DC-DET: fitted/missing/DNP capacitor gate'], upstreamValidatedByWorkbench: false };
}
