import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = data => createHash('sha256').update(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)).digest('hex');
export const readJSON = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(value, null, 2)); await fs.rename(tmp, file);
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
      else result.push({ path: path.relative(root, file).replaceAll('\\', '/'), bytes: (await fs.stat(file)).size, sha256: hash(await fs.readFile(file)) });
    }
  }
  await walk(root); return result.sort((a, b) => a.path.localeCompare(b.path));
}
