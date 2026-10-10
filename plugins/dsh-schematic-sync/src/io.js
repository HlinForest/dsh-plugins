import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { schematic, nodes, property } from './sexpr.js';

export const hash = data => createHash('sha256').update(data).digest('hex');
export const json = async p => JSON.parse(await fs.readFile(p, 'utf8'));
export const writeJson = (p, v) => fs.writeFile(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
export const within = (root, p) => { const r = path.relative(root, p); return r === '' || (!path.isAbsolute(r) && r !== '..' && !r.startsWith('..' + path.sep)); };
export async function inside(root, supplied) {
  const base = await fs.realpath(root), requested = path.resolve(base, supplied);
  if (!within(base, requested)) throw new Error('Path escapes workspaceRoot');
  const actual = await fs.realpath(requested);
  if (!within(base, actual)) throw new Error('Symlink/junction escapes workspaceRoot');
  return actual;
}
export async function readLimited(p, limit = 32 * 1024 * 1024) {
  const st = await fs.stat(p);
  if (!st.isFile() || st.size > limit) throw new Error('Invalid file or size limit exceeded');
  return fs.readFile(p);
}
export async function run(command, args, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => execFile(command, args, { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', signal }, (error, stdout, stderr) => {
    if (error) reject(new Error(`Command failed (${path.basename(command)}): ${signal?.aborted ? 'cancelled' : stderr || error.message}`));
    else resolve({ stdout, stderr });
  }));
}
export async function collect(root, filename, seen = new Set()) {
  const p = await inside(root, filename);
  if (seen.has(p)) return [];
  if (seen.size >= 100) throw new Error('Schematic hierarchy exceeds 100 sheets');
  seen.add(p); const bytes = await readLimited(p), ast = schematic(bytes.toString('utf8'));
  const files = [{ path: p, hash: hash(bytes), bytes }];
  for (const sheet of nodes(ast, 'sheet')) {
    const f = property(sheet, 'Sheetfile');
    if (!f || f.includes('${')) throw new Error('Resolve variable-based sheet paths before comparison');
    files.push(...await collect(root, path.resolve(path.dirname(p), f), seen));
  }
  return files;
}
export async function assertFresh(manifest) {
  for (const f of manifest) if (hash(await readLimited(f.path)) !== f.hash) throw new Error(`File changed; start a new comparison: ${f.path}`);
}
export async function assertUnlocked(current) {
  const dir = path.dirname(current), stem = path.basename(current, '.kicad_sch');
  const names = await fs.readdir(dir);
  if (names.some(n => n === `~${stem}.kicad_sch.lck` || n === `~${stem}.kicad_pro.lck` || n === `${stem}.kicad_sch.lck`)) throw new Error('KiCad project is open/locked. Save and close the project before applying or rolling back.');
}
export async function atomicReplace(filename, bytes) {
  const temp = filename + '.sync-' + randomUUID();
  try { await fs.writeFile(temp, bytes, { flag: 'wx' }); await fs.rename(temp, filename); }
  finally { await fs.unlink(temp).catch(() => {}); }
}

// Coordinate independent DSH instances / CLI processes writing the same project.
export async function withProjectLock(current, fn) {
  const lock = current + '.schematic-sync.lock';
  let handle;
  try { handle = await fs.open(lock, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another schematic-sync write is active (or left a recovery lock)'); throw error; }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); return await fn(); }
  finally { await handle.close(); await fs.unlink(lock); }
}
