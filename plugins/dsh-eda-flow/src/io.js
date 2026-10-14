import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const hash = data => createHash('sha256').update(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)).digest('hex');
export const readJSON = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const writes = new Map();
export function writeJSON(file, value) {
  const payload = JSON.stringify(value, null, 2);
  const next = (writes.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = file + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(tmp, payload);
      for (let attempt = 0; ; attempt++) {
        try { await fs.rename(tmp, file); break; }
        catch (error) {
          // Windows readers and antivirus may briefly deny replacing an open file.
          if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt >= 9) throw error;
          await delay(Math.min(40 * (attempt + 1), 250));
        }
      }
    } finally { await fs.unlink(tmp).catch(() => {}); }
  });
  writes.set(file, next);
  next.finally(() => { if (writes.get(file) === next) writes.delete(file); }).catch(() => {});
  return next;
}
export function inside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}
export async function within(root, file) {
  const base = await fs.realpath(root); const resolved = await fs.realpath(path.resolve(root, String(file || '.')));
  if (!inside(base, resolved)) throw new Error('文件必须位于配置的工程工作区内。');
  return resolved;
}
export async function tree(root) {
  const result = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('工程资料不能包含符号链接。');
      if (['__pycache__', '.git'].includes(entry.name)) continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else {
        // Size and digest must describe the same read, including on managed filesystems.
        const content = await fs.readFile(file);
        result.push({ path: path.relative(root, file).replaceAll('\\', '/'), bytes: content.length, sha256: hash(content) });
      }
    }
  }
  await walk(root); return result.sort((a, b) => a.path.localeCompare(b.path));
}

export function fileChanges(expected, current) {
  const before = new Map(expected.map(f => [f.path, f.sha256]));
  const after = new Map(current.map(f => [f.path, f.sha256]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(file =>
    before.get(file) === after.get(file) ? [] : [{ path: file, kind: !before.has(file) ? 'added' : !after.has(file) ? 'missing' : 'changed' }]);
}
export const sameFiles = (expected, current) => fileChanges(expected, current).length === 0;
