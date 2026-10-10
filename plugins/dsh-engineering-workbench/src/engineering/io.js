import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hash } from './model.js';
const exec = promisify(execFile);
export async function readLimited(file, limit = 64 * 1024 * 1024) { const s = await fs.stat(file); if (!s.isFile() || s.size > limit) throw new Error('文件过大或不是普通文件。'); return fs.readFile(file); }
export async function within(root, file) {
  if (!path.isAbsolute(file)) throw new Error('请选择绝对文件路径。');
  const [r, f] = await Promise.all([fs.realpath(root), fs.realpath(file)]), rel = path.relative(r, f);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('文件超出工作目录。');
  return f;
}
export async function atomic(file, data) { const temp = `${file}.${randomUUID()}.tmp`; try { await fs.writeFile(temp, data, { flag: 'wx' }); await fs.rename(temp, file); } finally { await fs.rm(temp, { force: true }); } }
export async function json(file, value) { await atomic(file, JSON.stringify(value, null, 2)); }
export async function run(command, args, signal, options = {}) {
  if (!command) throw new Error('此检查所需工具未配置。');
  const { stdout } = await exec(command, args, { windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024, signal, env: { ...process.env, PYTHONUTF8: '1' }, ...options }); return stdout;
}
export async function version(file) { return hash(await readLimited(file)); }
export async function assertUnlocked(file) {
  if (!/\.kicad_sch$/i.test(file)) return;
  const stem = path.basename(file, '.kicad_sch'), names = await fs.readdir(path.dirname(file));
  if (names.some(n => [`~${stem}.kicad_sch.lck`, `~${stem}.kicad_pro.lck`, `${stem}.kicad_sch.lck`].includes(n))) throw new Error('工程仍在 KiCad 中打开。请保存并关闭后再覆盖或回退。');
}
