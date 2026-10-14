// Run against the test-only UI server. Never calls a paid model.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PLAYWRIGHT_PACKAGE || 'D:/anaconda/Lib/site-packages/playwright/driver/package');
const root = path.resolve(process.argv[2]);
const executablePath = path.resolve(process.argv[3]);
await fs.mkdir(root, { recursive: true });
const connection = path.join(root, 'test-connection.json');
await fs.writeFile(connection, JSON.stringify({ port: 18516, key: 'a'.repeat(64), cookieName: 'eda_flow_1234' }));
const main = fileURLToPath(new URL('../desktop/main.cjs', import.meta.url));
const args = [main, `--eda-connection=${connection}`, `--eda-profile=${path.join(root, 'test-profile')}`];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const counter = await fetch('http://127.0.0.1:18516/test-control').then(r => r.json());
const instance = await _electron.launch({ executablePath, args, env, timeout: 30000 });
const errors = [];
let report;
try {
  const page = await instance.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.locator('.window-titlebar').waitFor();
  await page.getByRole('button', { name: '资料与提取', exact: false }).first().click();
  await page.getByRole('tab', { name: '器件 41', exact: true }).waitFor();
  const style = await page.evaluate(() => ({
    titlebarHeight: document.querySelector('.window-titlebar').getBoundingClientRect().height,
    titlebarBackground: getComputedStyle(document.querySelector('.window-titlebar')).backgroundColor,
    toolbarBackground: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
    toolbarTop: document.querySelector('.topbar').getBoundingClientRect().top,
    dragRegion: getComputedStyle(document.querySelector('.window-titlebar')).getPropertyValue('-webkit-app-region'),
    noNode: typeof window.require === 'undefined' && typeof window.process === 'undefined',
    bridgeKeys: Object.keys(window.edaDesktop), overlay: navigator.windowControlsOverlay.visible,
    overlayBounds: navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON(),
  }));
  assert.equal(style.titlebarHeight, 40); assert.equal(style.toolbarTop, 40);
  assert.equal(style.titlebarBackground, 'rgb(249, 250, 251)');
  assert.equal(style.toolbarBackground, style.titlebarBackground);
  assert.equal(style.dragRegion, 'drag'); assert(style.noNode); assert(style.overlay);
  assert.deepEqual(style.bridgeKeys, ['titlebarHeight']);
  await page.screenshot({ path: path.join(root, 'desktop-page.png') });
  const original = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.equal(original.width, 1280); assert.equal(original.height, 850);
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  assert(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()));
  await instance.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.restore(); w.maximize(); });
  await page.waitForFunction(() => innerWidth > 1400);
  assert(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()));
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  await page.waitForFunction(() => innerWidth < 1400);
  const child = spawn(executablePath, args, { env, stdio: 'ignore' });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.equal(exit, 0); assert.equal(instance.windows().length, 1);
  assert.deepEqual(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), original);
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 750));
  await page.getByRole('button', { name: '打开 AI 助手', exact: true }).click();
  assert.equal(await page.locator('.assistant').evaluate(e => e.getBoundingClientRect().top), 88);
  await page.getByRole('button', { name: '收起 AI 助手', exact: true }).click();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 850));
  const after = await fetch('http://127.0.0.1:18516/test-control').then(r => r.json());
  assert.equal(after.calls, counter.calls); assert.equal(after.realModelCalls, 0); assert.deepEqual(errors, []);
  report = { ...style, nativeBounds: original, minimizeMaximizeRestore: true, singleInstance: true,
    smallWindowDrawer: true, pageErrors: errors, modelCalls: 0 };
  await fs.writeFile(path.join(root, 'desktop-checks.json'), JSON.stringify(report, null, 2));
} finally { await instance.close(); }
console.log(JSON.stringify(report));
