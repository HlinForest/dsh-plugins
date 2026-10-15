// Installed plugin, real independent Electron window, real KiCad tools.
// Only the Harness model service is a test double. No host profile is modified.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { _electron } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
// The local Playwright driver includes automation but not @playwright/test.
const expect = locator => {
  const wait = async (probe, description) => {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await probe().catch(() => false)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${description}: ${locator}`);
  };
  return {
    toBeVisible: () => locator.waitFor({ state: 'visible' }),
    toBeEnabled: () => wait(() => locator.isEnabled(), 'Control did not become enabled'),
    toContainText: text => wait(async () => (await locator.textContent()).includes(text), 'Missing text ' + text),
    toHaveAttribute: (name, value) => wait(async () => await locator.getAttribute(name) === value, 'Attribute mismatch ' + name),
    not: { toHaveValue: value => wait(async () => await locator.inputValue() !== value, 'Input remained empty') },
  };
};
const [folder, pluginFolder, electronPath, pythonPath, cliPath] = process.argv.slice(2);
assert(folder && pluginFolder && electronPath && pythonPath && cliPath, 'Provide output, installed plugin, Electron, Python and KiCad CLI paths');
const root = path.resolve(folder), plugin = path.resolve(pluginFolder);
assert(!(await fs.stat(root).catch(() => null)), 'Use a new, empty run directory');
await fs.mkdir(path.join(root, 'screenshots'), { recursive: true });
await fs.mkdir(path.join(root, 'delivery'), { recursive: true });
const write = (name, data) => fs.writeFile(path.join(root, name), JSON.stringify(data, null, 2));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [{ Flow }, { harnessAI }, { DesignWindow }] = await Promise.all([
  'src/service.js', 'src/ai.js', 'src/window.js',
].map(name => import(pathToFileURL(path.join(plugin, name)).href)));
const manifest = JSON.parse(await fs.readFile(path.join(plugin, 'package.json'), 'utf8'));
const implementation = {};
for (const name of ['package.json', 'src/service.js', 'src/ai.js', 'src/window.js', 'client/app.js', 'client/styles.css', 'desktop/main.cjs']) {
  implementation[name] = hash(await fs.readFile(path.join(plugin, name)));
}
let modelRequests = 0;
const mockModel = { get: name => name === 'agentDefaultModel'
  ? { currentSelection: () => ({ provider: 'test-double', model: 'OFFLINE-SEVEN-STEP-VALIDATION' }) }
  : { async prepareCall() {
    modelRequests++;
    return { config: {}, async *stream(request) {
      const first = JSON.parse(request.messages[0].content[0].text);
      const result = request.messages.length === 1
        ? { action: 'read', files: [{ scope: 'prepared', path: 'engineer-inputs.json' }] }
        : { action: 'plan', version: 1, executor: first.request.structuredEligible ? 'structured' : 'local',
          summary: '模拟模型读取本步输入，使用真实工具生成并检查。', gaps: [], assumptions: [] };
      yield { type: 'text-delta', index: 0, text: JSON.stringify(result) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    } };
  } },
};
const flow = new Flow({ workspaceRoot: root, workDirectory: root, kicadPython: path.resolve(pythonPath),
  kicadCli: path.resolve(cliPath), allowModelCalls: true, skip3d: false }, harnessAI(mockModel));
const designWindow = new DesignWindow(flow);
const origin = await designWindow.start();
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let instance, page, projectId, firstHash;
const startedAt = new Date().toISOString(), stages = [], observations = [], uiActions = [], pageErrors = [], externalRequests = [];
const names = ['任务与约束','资料与提取','器件与规格书','原理图','BOM 与封装','PCB','核验与交付'];
const actions = ['', '整理输入','读取并核对','生成原理图','生成并核对','生成 PCB','运行核验'];
const state = async () => {
  const response = await fetch(origin + '/api/eda-flow/action', { method: 'POST',
    headers: { 'content-type': 'application/json', Cookie: `${designWindow.cookieName}=${designWindow.key}` },
    body: JSON.stringify({ action: 'open', projectId }) });
  const result = await response.json(); assert(result.ok, result.error); return result.value;
};
const bootstrapState = () => fetch(origin + '/api/eda-flow/bootstrap', {
  headers: { Cookie: `${designWindow.cookieName}=${designWindow.key}` },
}).then(response => response.json());
const screenshot = name => page.screenshot({ path: path.join(root, 'screenshots', name + '.png') });
const checkPrevious = (project, stage) => {
  for (const prior of project.stages.filter(s => s.id < stage)) {
    assert.equal(prior.status, 'done', `Step ${stage} invalidated step ${prior.id}: ${prior.invalidation?.message || prior.error}`);
    assert.equal(prior.confirmed, true, `Step ${stage} revoked confirmation ${prior.id}`);
  }
  if (firstHash) assert.equal(project.stages[0].outputHash, firstHash, `Step ${stage} changed the first output hash`);
};
async function waitForResult(stage) {
  const deadline = Date.now() + 15 * 60 * 1000;
  let signature = '';
  while (Date.now() < deadline) {
    const project = await state(), current = project.stages[stage - 1];
    checkPrevious(project, stage);
    const next = JSON.stringify([current.status, project.phase, project.progress]);
    if (next !== signature) {
      signature = next;
      const entry = { at: new Date().toISOString(), stage, status: current.status, phase: project.phase, progress: project.progress,
        firstConfirmed: project.stages[0].confirmed, firstOutputHash: project.stages[0].outputHash };
      observations.push(entry); await write('progress.json', observations);
      console.log(JSON.stringify({ event: 'progress', stage, status: current.status, phase: project.phase, firstConfirmed: entry.firstConfirmed }));
    }
    assert(!['failed','cancelled','interrupted','stale'].includes(current.status), current.error || current.invalidation?.message || current.status);
    if (current.status === 'done' && !project.busy) return project;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Stage ${stage} timed out`);
}
async function visitTabs(stage) {
  const tabs = await page.locator('.main-tabs [role=tab]').allTextContents();
  for (const title of tabs) {
    await page.locator('.main-tabs').getByRole('tab', { name: title, exact: true }).click();
    await expect(page.locator('.main-tabs').getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true');
    if (stage === 4 && title === '图纸' || stage === 6 && title === '预览与检查') {
      await page.waitForFunction(() => {
        const images = [...document.querySelectorAll('.preview-card img')];
        return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0);
      }, null, { timeout: 30000 });
      if (stage === 6) assert.equal(await page.locator('.preview-card img').count(), 4, 'PCB needs top/bottom and both 3D previews');
      await screenshot(`step-${stage}-previews`);
      await page.locator('.image-button').first().click();
      await expect(page.getByRole('dialog').locator('img')).toBeVisible();
      await screenshot(`step-${stage}-enlarged`);
      await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    }
  }
  return tabs;
}
try {
  instance = await _electron.launch({ executablePath: path.resolve(electronPath), args: [path.join(plugin, 'desktop/main.cjs'),
    '--eda-connection=' + path.join(root, 'design-window-session.json'), '--eda-profile=' + path.join(root, 'test-desktop-profile')], env, timeout: 30000 });
  page = await instance.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.context().route('**/*', route => {
    if (!route.request().url().startsWith(origin + '/') && /^https?:/.test(route.request().url())) {
      externalRequests.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  page.on('request', request => {
    if (request.url().endsWith('/api/eda-flow/action') && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (!['open','read','data','records'].includes(body.action)) uiActions.push({ at: new Date().toISOString(), action: body.action, stage: body.stage, allowDraft: body.allowDraft });
    }
  });
  await expect(page.locator('.window-titlebar')).toBeVisible();
  await expect(page.locator('.nav-foot')).toContainText('运行后台 ' + manifest.version);
  const bootstrap = await bootstrapState();
  assert.equal(bootstrap.value.version, manifest.version); assert.equal(bootstrap.value.projects.length, 0);
  await page.locator('.top-actions').getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('显示板 · 七步实点验证');
  await page.getByRole('radio', { name: /使用显示板输入/ }).check();
  const createResponse = page.waitForResponse(response => response.url().endsWith('/api/eda-flow/action') && response.request().postDataJSON()?.action === 'create');
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  const created = await (await createResponse).json(); assert(created.ok, created.error); projectId = created.value.id;
  assert(created.value.stages.every(s => !s.confirmed && s.status === 'pending' && !s.output));
  await expect(page.getByRole('heading', { name: names[0], exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '项目需求', exact: true })).not.toHaveValue('');
  await screenshot('step-1-inputs');
  for (let number = 1; number <= 7; number++) {
    console.log(JSON.stringify({ event: 'step-start', stage: number, title: names[number - 1] }));
    await expect(page.getByRole('heading', { name: names[number - 1], exact: true })).toBeVisible();
    const start = Date.now();
    let project = await state(); checkPrevious(project, number);
    if (number > 1) {
      await page.locator('.footer-actions').getByRole('button', { name: actions[number - 1], exact: true }).click();
      project = await waitForResult(number);
      await expect(page.locator('.footer-actions').getByRole('button', { name: '重新' + actions[number - 1], exact: true })).toBeEnabled();
    }
    const tabs = await visitTabs(number), current = project.stages[number - 1];
    const draft = Boolean(current.gaps.length || current.assumptions.length);
    if (draft) {
      await expect(page.getByRole('region', { name: '本步待确认项' })).toBeVisible();
      await page.getByRole('checkbox', { name: '带待确认项继续草稿', exact: true }).check();
    }
    await screenshot(`step-${number}-before-confirm`);
    const confirmResponse = page.waitForResponse(response => response.url().endsWith('/api/eda-flow/action') && response.request().postDataJSON()?.action === 'confirm');
    await page.locator('.footer-actions').getByRole('button', { name: number === 7 ? '确认交付' : '确认并继续', exact: true }).click();
    const confirmed = await (await confirmResponse).json(); assert(confirmed.ok, confirmed.error);
    project = confirmed.value;
    checkPrevious(project, number + 1);
    assert.equal(project.stages[number - 1].confirmed, true);
    if (number === 1) { firstHash = project.stages[0].outputHash; assert.equal(modelRequests, 0); }
    if (number < 7) await expect(page.getByRole('heading', { name: names[number], exact: true })).toBeVisible();
    else await expect(page.getByRole('status')).toContainText('交付确认已记录');
    const record = { stage: number, title: names[number - 1], confirmed: true, draft, gaps: current.gaps,
      assumptions: current.assumptions, tabsVisited: tabs, elapsedSeconds: Math.round((Date.now() - start) / 1000),
      firstConfirmed: project.stages[0].confirmed, firstOutputHash: project.stages[0].outputHash,
      output: project.stages[number - 1].output, outputHash: project.stages[number - 1].outputHash };
    stages.push(record); await write('step-results.json', stages); await write('ui-actions.json', uiActions);
    console.log(JSON.stringify({ event: 'step-confirmed', stage: number, draft, gaps: current.gaps.length, firstConfirmed: record.firstConfirmed }));
    await screenshot(`step-${number}-confirmed`);
  }
  const project = await state(); checkPrevious(project, 8);
  assert(project.stages.every(s => s.confirmed && s.status === 'done'));
  assert.equal(modelRequests, project.modelRequests);
  const final = project.stages[6]; assert.equal(final.result.comparison.equal, true);
  assert.equal(final.result.comparison.categories, 28);
  const projects = (await bootstrapState()).value.projects;
  assert.equal(projects.length, 1, 'UI execution must not create extra projects');
  assert.equal(uiActions.filter(a => a.action === 'create').length, 1);
  assert.deepEqual(uiActions.filter(a => a.action === 'execute').map(a => a.stage), [2,3,4,5,6,7]);
  assert.deepEqual(uiActions.filter(a => a.action === 'confirm').map(a => a.stage), [1,2,3,4,5,6,7]);
  await page.locator('.main-tabs').getByRole('tab', { name: '交付文件', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索本次生成文件', exact: true }).fill('DisplayBoard.zip');
  // Electron's native download can complete without Playwright's page event.
  const savedZip = path.join(root, 'delivery/DisplayBoard.zip');
  await instance.evaluate(({ session }, destination) => {
    globalThis.edaValidationDownload = { state: 'waiting' };
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(destination);
      globalThis.edaValidationDownload = { state: 'started' };
      item.once('done', (_event, state) => { globalThis.edaValidationDownload = { state, name: item.getFilename(), bytes: item.getReceivedBytes() }; });
    });
  }, savedZip);
  await page.getByRole('table', { name: '本次生成文件', exact: true }).getByRole('link', { name: '下载', exact: true }).click();
  const downloadDeadline = Date.now() + 60000; let nativeDownload;
  while (Date.now() < downloadDeadline) {
    nativeDownload = await instance.evaluate(() => globalThis.edaValidationDownload);
    if (['completed','interrupted','cancelled'].includes(nativeDownload.state)) break;
    await page.waitForTimeout(250);
  }
  assert.equal(nativeDownload.state, 'completed', JSON.stringify(nativeDownload));
  assert.equal(hash(await fs.readFile(savedZip)), hash(await fs.readFile(path.join(final.output, 'DisplayBoard.zip'))));
  await page.getByRole('table', { name: '本次生成文件', exact: true }).scrollIntoViewIfNeeded();
  await screenshot('step-7-delivery-download');
  await page.reload();
  await expect(page.locator('.project-trigger')).toContainText('显示板 · 七步实点验证');
  const reopened = await state(); checkPrevious(reopened, 8);
  assert.equal(await page.locator('.step-number.confirmed').count(), 7);
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  const report = { passed: true, startedAt, finishedAt: new Date().toISOString(), version: manifest.version, implementation,
    interface: 'Installed plugin in its native independent Electron window; all mutations through UI clicks',
    projectId, projectLabel: project.label, steps: stages, firstConfirmationPreserved: true, firstHashUnchanged: true,
    reference: final.result.comparison, generatedProject: path.join(final.output, 'project'),
    deliveryZip: path.join(root, 'delivery/DisplayBoard.zip'), modelRequests, realModelCalls: 0,
    modelProvider: 'test-double', tools: 'Actual KiCad and Python; 3D renders enabled',
    remainingGaps: final.gaps, erc: final.result.erc, drc: final.result.drc,
    confirmedAsDraft: final.confirmation.draft, reloadPreservesSevenConfirmations: true,
    pageErrors, externalRequests, nativeDownload, projectCount: projects.length };
  await write('verification.json', report);
  await write('operation-records.json', project.events);
  console.log(JSON.stringify({ event: 'passed', version: manifest.version, projectId, confirmedSteps: 7, comparedCategories: 28, realModelCalls: 0 }));
} catch (error) {
  await write('failure.json', { at: new Date().toISOString(), projectId, error: error.message, stack: error.stack, stages, pageErrors, modelRequests, realModelCalls: 0 });
  if (page) await screenshot('failure').catch(() => {});
  throw error;
} finally {
  await write('ui-actions.json', uiActions);
  if (instance) await instance.close();
  await flow.close(); await designWindow.close();
}
