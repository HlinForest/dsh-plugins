import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readJSON } from './io.js';

// One transactional database per project keeps project directories portable.
const pending = new Map();
export function saveProject(directory, project, migrate = false) {
  const body = JSON.stringify(project);
  const operation = (pending.get(directory) || Promise.resolve()).catch(() => {}).then(async () => {
  await fs.mkdir(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'project.sqlite'));
  try {
    db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    db.prepare(migrate ? 'INSERT OR IGNORE INTO state(id,body) VALUES(1,?)' : 'INSERT INTO state(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(body);
  } finally { db.close(); }
  });
  pending.set(directory, operation);
  operation.finally(() => { if (pending.get(directory) === operation) pending.delete(directory); }).catch(() => {});
  return operation;
}

export async function loadProject(directory) {
  if (pending.has(directory)) await pending.get(directory);
  const file = path.join(directory, 'project.sqlite');
  try { await fs.access(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const project = await readJSON(path.join(directory, 'project.json'));
    await saveProject(directory, project, true);
    return loadProject(directory); // Original legacy file is retained unchanged.
  }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const row = db.prepare('SELECT body FROM state WHERE id=1').get();
    if (!row) throw new Error('项目数据库缺少状态记录。');
    return JSON.parse(row.body);
  } finally { db.close(); }
}
