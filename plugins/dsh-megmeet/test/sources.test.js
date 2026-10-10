import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReport, loadCatalog, parseRequirements, searchProducts, sourceLinks, validateCatalog } from '../lib/domain.js';

test('资料版本含官网和DSH可识别的本地链接，路径特殊字符不破坏Markdown', () => {
  const source = { id: 'PS-1', title: '规格书', version: 'Rev1', location: '第2页', url: 'https://example.com/spec(1).pdf#page=2', file: 'D:\\资料库\\规格 (1)|A.pdf' };
  const links = sourceLinks(source);
  assert.equal(links[0].href, 'https://example.com/spec%281%29.pdf#page=2');
  assert.equal(decodeURIComponent(links[1].href), 'D:/资料库/规格 (1)|A.pdf');
  assert.match(links[0].markdown, /^\[官网资料入口\]\(https:/);
  assert.match(links[1].markdown, /^\[PS-1 · Rev1\]\(D:/);
  assert.doesNotMatch(links[1].href, /file:|[()|\s]/);
});

test('危险协议、凭据、UNC、非法行号和控制字符不能成为来源链接', async () => {
  const catalog = await loadCatalog('');
  for (const url of ['javascript:alert(1)', 'file:///D:/spec.pdf', 'https://name:secret@example.com/spec', 'https://example.com/\nfoo']) {
    const c = structuredClone(catalog); c.sources[0].url = url;
    assert.throws(() => validateCatalog(c));
  }
  for (const file of ['\\\\server\\spec.pdf', 'file:///D:/spec.pdf', 'x.pdf#L1', 'x.pdf?query']) {
    const c = structuredClone(catalog); c.sources[0].file = file;
    assert.throws(() => validateCatalog(c));
  }
  const c = structuredClone(catalog); c.sources[0].line = 0;
  assert.throws(() => validateCatalog(c));
});

test('相对原件按产品库位置解析，报告保留可点击版本与行号', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'megmeet-sources-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const catalog = JSON.parse(await readFile(new URL('../examples/catalog.demo.json', import.meta.url), 'utf8'));
  catalog.sources[0].file = '资料 (A).md'; catalog.sources[0].line = 5;
  catalog.sources[0].url = 'https://example.com/spec.pdf';
  await writeFile(join(dir, 'catalog.json'), JSON.stringify(catalog));
  const loaded = await loadCatalog(join(dir, 'catalog.json'));
  assert.equal(loaded.sources[0].file, join(dir, '资料 (A).md'));
  assert.match(loaded.sources[0].links[1].href, /#L5$/);
  const report = generateReport(searchProducts(loaded, parseRequirements('输出功率：≥3000W')));
  assert.ok(report.markdown.includes(loaded.sources[0].links[0].markdown));
  assert.ok(report.markdown.includes(loaded.sources[0].links[1].markdown));
  assert.doesNotMatch(report.markdown, /file:\/\//);
});
