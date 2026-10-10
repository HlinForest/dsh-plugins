import fs from 'node:fs/promises';
import path from 'node:path';
import { atomic, readLimited, version, within } from './io.js';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// A small, interoperable ZIP writer with stored entries. No external executable is
// required for exporting a KiCad project on an otherwise standalone installation.
export async function archive(directory, records, report, destination) {
  const entries = [];
  for (const r of records) {
    const file = await within(directory, path.join(directory, r.relative));
    entries.push({ name: r.relative.replaceAll('\\', '/'), data: await readLimited(file), sha256: await version(file) });
  }
  entries.push({ name: 'engineering-manifest.json', data: Buffer.from(JSON.stringify({ ...report, files: entries.map(e => ({ file: e.name, sha256: e.sha256 })) }, null, 2)) });
  if (entries.reduce((n, e) => n + e.data.length, 0) > 256 * 1024 * 1024) throw new Error('候选包超过 256 MiB，请从任务目录复制完整工程。');
  const chunks = [], central = []; let offset = 0;
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.split('/').includes('..')) throw new Error('候选包路径无效。');
    const name = Buffer.from(entry.name), crc = crc32(entry.data), local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    const row = Buffer.alloc(46); row.writeUInt32LE(0x02014b50); row.writeUInt16LE(20, 4); row.writeUInt16LE(20, 6); row.writeUInt16LE(0x800, 8); row.writeUInt16LE(33, 14);
    row.writeUInt32LE(crc, 16); row.writeUInt32LE(entry.data.length, 20); row.writeUInt32LE(entry.data.length, 24); row.writeUInt16LE(name.length, 28); row.writeUInt32LE(offset, 42);
    chunks.push(local, name, entry.data); central.push(row, name); offset += local.length + name.length + entry.data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  await fs.mkdir(path.dirname(destination), { recursive: true }); await atomic(destination, Buffer.concat([...chunks, ...central, end]));
  return destination;
}
