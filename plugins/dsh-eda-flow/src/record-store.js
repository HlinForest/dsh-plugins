import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

// Shared with Python's record_io. JSON files are delivery exports; this database
// holds the authoritative records exchanged by the application and CAD workers.
const filename = '.eda-records.sqlite';
const digest = text => createHash('sha256').update(text).digest('hex');
export function storedText(file) {
  const dbfile = path.join(path.dirname(file), filename);
  if (!fs.existsSync(dbfile)) return undefined;
  const db = new DatabaseSync(dbfile, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=10000');
    const row = db.prepare('SELECT body, sha256 FROM records WHERE name=?').get(path.basename(file));
    if (!row) return undefined;
    if (digest(row.body) !== row.sha256) throw new Error(`记录数据库校验失败：${file}`);
    return row.body;
  } finally { db.close(); }
}
export function storeText(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(path.join(path.dirname(file), filename));
  try {
    db.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS records (name TEXT PRIMARY KEY, body TEXT NOT NULL, sha256 TEXT NOT NULL)');
    db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET body=excluded.body,sha256=excluded.sha256 WHERE records.body != excluded.body').run(path.basename(file), body, digest(body));
  } finally { db.close(); }
}
