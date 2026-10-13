import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { within } from './engineering/io.js';

const PAGE = 'https://www.megmeet.com/service';
const HOSTS = new Set(['www.megmeet.com', 'megmeet.com', 'megmeet-official-website.oss-cn-hangzhou.aliyuncs.com']);
export async function readOfficialIndex(file) {
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.items) || value.items.length > 20000) throw new Error('官网资料索引无效。');
  return value;
}
function safeUrl(value) {
  const url = new URL(value, PAGE);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) throw new Error('资料下载地址不在麦格米特官方资料域名范围内。');
  return url;
}
async function officialFetch(url, options) {
  for (let hops = 0; hops < 5; hops++) {
    const response = await fetch(safeUrl(url), { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    url = new URL(response.headers.get('location'), url); await response.body?.cancel();
  }
  throw new Error('官网下载重定向过多。');
}
async function limited(response, max) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`官网下载失败（${response.status}）。`); }
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('官网文件超过读取大小限制。'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > max) throw new Error('官网文件超过读取大小限制。'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
// OSS links expire. Ask the same public search used by the website for a fresh URL,
// then bind it to the indexed object's exact origin and pathname, never just its title.
export async function resolveOfficialDownload(item, signal) {
  const stable = safeUrl(item.url);
  if (stable.hostname !== 'megmeet-official-website.oss-cn-hangzhou.aliyuncs.com') return stable.href;
  const response = await officialFetch('https://www.megmeet.com/Service/getsearch.html', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', referer: PAGE }, body: new URLSearchParams({ key: item.models[0] || item.title }), signal });
  const data = JSON.parse((await limited(response, 8 * 1024 * 1024)).toString('utf8'));
  if (data.status !== 1 || typeof data.html !== 'string') throw new Error('官网检索未返回有效资料。');
  const decode = value => new XMLParser().parse(`<value>${value.replace(/</g, '&lt;')}</value>`).value;
  for (const match of data.html.matchAll(/(?:data-url|href)="([^"]+)"/g)) {
    let candidate;
    try { candidate = safeUrl(decode(match[1])); } catch { continue; }
    if (candidate.origin === stable.origin && candidate.pathname === stable.pathname) return candidate.href;
  }
  throw new Error('官网当前检索未找到该原件，请更新官网索引后重试。');
}
export async function readOfficialDocument(item, config, signal) {
  if (item.format !== 'pdf') throw new Error('读手册目前支持 PDF；其他格式请从官网资料入口下载。');
  if (!/^megmeet-[a-f0-9]{20}$/.test(item.id)) throw new Error('官网资料 ID 无效。');
  const directory = path.join(config.workDirectory, 'official-materials');
  await fs.mkdir(directory, { recursive: true }); await within(config.workspaceRoot, directory);
  const target = path.join(directory, item.id + '.pdf');
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120000)]);
  // Refresh each import: the task's independent snapshot pins the exact bytes that were read.
  const url = await resolveOfficialDownload(item, deadline);
  const buffer = await limited(await officialFetch(url, { signal: deadline, headers: { referer: PAGE } }), 64 * 1024 * 1024);
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('官网返回的文件不是 PDF，请在官网核对该条目。');
  const temp = `${target}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, buffer, { flag: 'wx' }); await fs.rename(temp, target); } finally { await fs.rm(temp, { force: true }); }
  return { filePath: target, officialPage: PAGE, documentUrl: item.url, sha256: createHash('sha256').update(buffer).digest('hex') };
}
