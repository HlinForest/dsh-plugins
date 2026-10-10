import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const materialsDir = path.join(root, 'materials');
const searchSnapshotPath = path.join(materialsDir, 'industrial-mpt-search.json');
const manifestPath = path.join(materialsDir, 'download-manifest.json');
const officialPage = 'https://megmeet.com/service?id=75';

const wanted = new Map([
  ['MPT35-xxV（Ⅱ代）用户使用指导书', 'megmeet-mpt35-ii-user-guide.pdf'],
  ['MPT50-xxV（Ⅱ代）用户使用指导书', 'megmeet-mpt50-ii-user-guide.pdf'],
  ['MPT75-xxV（Ⅱ代）用户使用指导书', 'megmeet-mpt75-ii-user-guide.pdf'],
  ['MPT100-xxV（Ⅱ代）用户使用指导书', 'megmeet-mpt100-ii-user-guide.pdf'],
  ['MPT150-xxV（Ⅱ代）用户使用指导书', 'megmeet-mpt150-ii-user-guide.pdf'],
  ['MPT210-xxV（Ⅱ代）用户使用指导书', 'megmeet-mpt210-ii-user-guide.pdf'],
  ['MPT350-xxV（Ⅱ代）用户使用指导书', 'megmeet-mpt350-ii-user-guide.pdf'],
  ['MPT600-xxV（Ⅰ代）用户使用指导书', 'megmeet-mpt600-i-user-guide.pdf']
]);

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .trim();
}

function parseItems(html) {
  const items = [];
  for (const segment of html.split('<div class="item">').slice(1)) {
    const title = segment.match(/<div class="title[^>]*>([^<]*)<\/div>/)?.[1];
    const date = segment.match(/<div class="time">([^<]*)<\/div>/)?.[1];
    const url = segment.match(/<a href="([^"]+)" class="view"/)?.[1];
    if (title && date && url) items.push({ title: decodeHtml(title), date: date.trim(), url: decodeHtml(url) });
  }
  return items;
}

async function download(item, fileName) {
  const response = await fetch(item.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: officialPage,
      Accept: 'application/pdf,*/*'
    }
  });
  if (!response.ok) throw new Error(`${item.title}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    throw new Error(`${item.title}: response is not a PDF (${bytes.subarray(0, 16).toString('utf8')})`);
  }
  const target = path.join(materialsDir, fileName);
  await fs.writeFile(target, bytes);
  return {
    id: fileName.replace(/\.pdf$/i, ''),
    title: item.title,
    officialPage,
    documentPath: fileName,
    documentUrl: item.url,
    publicationDate: item.date,
    discoverySource: 'POST https://megmeet.com/Service/getsearch.html with key=MPT',
    searchSnapshot: 'industrial-mpt-search.json',
    downloadedAt: '2026-10-09',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length
  };
}

const payload = JSON.parse((await fs.readFile(searchSnapshotPath, 'utf8')).replace(/^\uFEFF/, ''));
if (payload.status !== 1 || typeof payload.html !== 'string') throw new Error('Invalid official MPT search snapshot');
const items = parseItems(payload.html);
const missing = [...wanted.keys()].filter((title) => !items.some((item) => item.title === title));
if (missing.length) throw new Error(`Missing official MPT entries: ${missing.join(', ')}`);

const downloaded = [];
for (const [title, fileName] of wanted) {
  const item = items.find((candidate) => candidate.title === title);
  downloaded.push(await download(item, fileName));
}

const existing = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const existingIds = new Set(existing.map((entry) => entry.id));
const merged = [...existing, ...downloaded.filter((entry) => !existingIds.has(entry.id))];
await fs.writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ count: downloaded.length, entries: downloaded }, null, 2));
