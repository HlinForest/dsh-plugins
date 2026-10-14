// Isolated host-slot fixture: launch responses are simulated; no model or host mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'D:/anaconda/Lib/site-packages/playwright/driver/package');
const output = path.resolve(process.argv[2]); await fs.mkdir(output, { recursive: true });
const plugin = fileURLToPath(new URL('..', import.meta.url));
const client = await fs.readFile(path.join(plugin, 'client.js'), 'utf8');
const bundle = await build({ stdin: { contents: `
  import React from 'react'; import { createRoot } from 'react-dom/client';
  window.launches = [];
  window.fetch = (_url, options) => { window.launches.push(JSON.parse(options.body));
    return new Promise(resolve => { window.finishLaunch = result => resolve({json:async()=>result}); }); };
  window.__ModuleLoader__ = {load:module=>module.factory(name=>{if(name==='react')return React;throw Error(name);}).apply({
    get:name=>{if(name!=='slots')throw Error(name);return {inject:(_name,register)=>register(),
      register:(_meta,Entry)=>createRoot(document.getElementById('entry')).render(React.createElement(Entry))};}
  })};
  ${client}
`, resolveDir: plugin }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 300 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<body style="font:14px Segoe UI;background:#f9fafb"><div style="display:flex;align-items:center;padding:140px 20px 0"><div id="entry" style="display:contents"></div><button id="neighbor" style="height:40px;border:0;background:transparent">工程工作台</button></div><input aria-label="聊天输入" /></body>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const button = page.getByRole('button', { name: '电路设计', exact: true });
  await button.waitFor();
  const geometry = await button.boundingBox(), sibling = await page.locator('#neighbor').boundingBox();
  assert.equal(geometry.width, 40); assert.equal(geometry.height, 40);
  assert.equal((await button.locator('svg').boundingBox()).width, 20);
  assert.equal(await button.innerText(), ''); assert(sibling.x - geometry.x - geometry.width >= 8);
  await button.hover(); await page.getByRole('tooltip').waitFor();
  assert.equal(await page.getByRole('tooltip').innerText(), '电路设计 · 独立窗口');
  await button.focus(); assert.equal(await button.evaluate(e => getComputedStyle(e).outlineWidth), '2px');
  await button.press('Enter');
  assert(await button.isDisabled()); assert.equal(await button.getAttribute('aria-busy'), 'true');
  assert.deepEqual(await button.boundingBox(), geometry);
  await page.evaluate(() => window.finishLaunch({ ok: false, error: '模拟窗口启动失败' }));
  await page.getByRole('alert').waitFor({ state: 'attached' });
  assert.equal(await page.getByRole('alert').innerText(), '模拟窗口启动失败');
  assert.deepEqual(await button.boundingBox(), geometry); assert.deepEqual(await page.locator('#neighbor').boundingBox(), sibling);
  assert((await page.getByRole('tooltip').innerText()).includes('点击重试'));
  await button.click(); await page.evaluate(() => window.finishLaunch({ ok: true }));
  await page.getByRole('alert').waitFor({ state: 'detached' });
  await page.waitForFunction(() => !document.querySelector('button[aria-label="电路设计"]').disabled);
  assert(await button.isEnabled());
  await page.getByRole('textbox', { name: '聊天输入' }).focus();
  assert(await page.getByRole('textbox').evaluate(e => document.activeElement === e));
  assert.deepEqual(await page.evaluate(() => window.launches), [{ action: 'open-window' }, { action: 'open-window' }]);
  assert.deepEqual(errors, []);
  const report = { fixture: 'host slot with simulated launch responses', button: geometry, gap: sibling.x-geometry.x-40,
    icon: 20, tooltip: true, keyboardOpen: true, busyKeepsSize: true, failureKeepsSize: true,
    retry: true, pageErrors: errors, realModelRequests: 0 };
  await fs.writeFile(path.join(output, 'entry-fixture-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
