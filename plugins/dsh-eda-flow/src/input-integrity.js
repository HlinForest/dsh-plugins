import fs from 'node:fs/promises';
import { hash, fileChanges, within } from './io.js';

// Diagnose bytes; never strip wrappers, decrypt, or accept a changed hash.
export function byteEvidence(data) {
  const tsdHeader = /%?TSD-Header/.test(data.subarray(0, 64).toString('latin1'));
  let utf8 = true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { utf8 = false; }
  const text = utf8 && !tsdHeader ? data.toString('utf8') : '';
  return { bytes: data.length, sha256: hash(data), tsdHeader, utf8,
    utf8Bom: data.subarray(0, 3).equals(Buffer.from([239,187,191])),
    crlf: text.split('\r\n').length - 1, bareLf: (text.match(/(?<!\r)\n/g) || []).length };
}

export async function inspectDefaultBundle(project, current, manifest) {
  const baseline = project.bundleFiles;
  const recordValid = baseline ? hash(baseline) === project.bundleHash : hash(current) === project.bundleHash;
  const differences = baseline ? fileChanges(baseline, current) : [];
  const observed = new Map(current.map(f => [f.path, f]));
  // Copying already wrapped files must not establish them as valid default data.
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (observed.get(name)?.sha256 !== expected && !differences.some(f => f.path === name)) {
      differences.push({ path: name, kind: observed.has(name) ? 'changed' : 'missing' });
    }
  }
  if (recordValid && !differences.length) return null;
  const readings = [];
  for (const file of differences) {
    let evidence;
    try { evidence = byteEvidence(await fs.readFile(await within(project.inputsBundle, file.path))); }
    catch { evidence = { unavailable: true }; }
    readings.push({ path: file.path, expectedSha256: baseline?.find(f => f.path === file.path)?.sha256 || null,
      distributedSha256: manifest.files[file.path] || null, ...evidence });
  }
  const protectedFiles = readings.filter(f => f.tsdHeader);
  const from = !recordValid || differences.some(f => !/^(02_materials|03_components|04_schematic|05_footprints|06_pcb|08_dependencies)\//.test(f.path)) ? 1 : 2;
  const names = differences.slice(0, 3).map(f => f.path).join('、') + (differences.length > 3 ? `等 ${differences.length} 个文件` : '');
  const message = protectedFiles.length
    ? `默认资料读取到 TSD-Header 保护格式：${names}。当前进程无法按原始 CSV/数据读取。请由内网 IT 核对 Harness、Node 与 KiCad Python 的读取授权，或在获准的环境导出可读副本；处理后重新检查资料。`
    : `显示板默认资料的校验不一致${names ? '：' + names : '，校验记录需要核对'}。请点击“检查资料读取”区分文件变化与进程读取差异。`;
  return { kind: 'default-input-files', code: protectedFiles.length ? 'encrypted' : 'integrity', from,
    files: differences, readings, message };
}

export function compareReaders(expectedFiles, nodeReadings, pythonReadings) {
  const expected = new Map(expectedFiles.map(f => [f.path, f.sha256]));
  const python = new Map(pythonReadings.map(f => [f.path, f]));
  return nodeReadings.map(node => {
    const other = python.get(node.path) || { unavailable: true };
    const status = node.tsdHeader || other.tsdHeader ? 'tsd-protected'
      : node.unavailable || other.unavailable ? 'unreadable'
      : node.sha256 !== other.sha256 ? 'reader-mismatch'
      : node.sha256 !== expected.get(node.path) ? 'content-mismatch' : 'verified';
    return { path: node.path, expectedSha256: expected.get(node.path) || null, status, node, python: other };
  });
}
