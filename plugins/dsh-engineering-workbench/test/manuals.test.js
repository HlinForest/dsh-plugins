import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Workbench } from '../src/service.js';
import { EngineeringTasks } from '../src/engineering/tasks.js';

const python = 'D:/VisualBoard/dsh-engineering-tools/.venv/Scripts/python.exe';
async function fixture(t, pages = 224, vision) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manual-book-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'manual.pdf');
  execFileSync(python, ['-c', `import pymupdf,sys\nd=pymupdf.open()\nfor n in range(int(sys.argv[2])):\n p=d.new_page();p.insert_text((50,60), 'Chapter %d: output voltage %d V. LatePageMarker' % (n+1,n+1) if n==int(sys.argv[2])-1 else 'Chapter %d: operating instructions.'%(n+1))\nd.set_toc([[1,'Introduction',1],[1,'Specifications',int(sys.argv[2])]])\nd.save(sys.argv[1])`, file, String(pages)], { windowsHide: true });
  const workbench = new Workbench({ workspaceRoot: dir, workDirectory: path.join(dir, 'work'), engineeringPython: python });
  const tasks = new EngineeringTasks(workbench, vision);
  t.after(() => tasks.manuals.dispose());
  return { tasks, file, dir };
}

test('opening a 224-page manual automatically indexes every page and the final chapter', async t => {
  const { tasks, file } = await fixture(t);
  const task = await tasks.dispatch({ action: 'create', kind: 'datasheet', left: file });
  assert.equal(task.manual?.indexedPages, 224, 'Reading a book must not stop at the single preview page');
  assert.equal(task.manual.toc.at(-1).page, 224);
  const found = await tasks.manuals.dispatch({ action: 'search', taskId: task.id, query: 'LatePageMarker' });
  assert.equal(found.items[0].page, 224);
  assert.match(found.items[0].quote, /224 V/);
});

test('automatic reading reaches page 224, validates quotations, and survives reopening', async t => {
  const seen = [];
  const reader = { interpret: async view => {
    seen.push(...view.blocks.map(b => b.page));
    const block = view.blocks.at(-1);
    return JSON.stringify({ notes: [{ text: 'Source-backed note', citations: [{ page: block.page, quote: block.text.trim() }] }, { text: 'Fabricated note', citations: [{ page: block.page, quote: 'invented source quotation' }] }], facts: [], unresolved: [] });
  } };
  const { tasks, file } = await fixture(t, 224, reader);
  const task = await tasks.dispatch({ action: 'create', kind: 'datasheet', left: file });
  await tasks.manuals.dispatch({ action: 'start', mode: 'book', taskId: task.id });
  await tasks.manuals.jobs.get(task.id)?.promise;
  const status = await tasks.manuals.dispatch({ action: 'status', taskId: task.id });
  assert.equal(status.book.state, 'complete', status.book.message);
  assert.equal(status.book.completedPages.length, 224);
  assert.deepEqual([...new Set(seen)], Array.from({ length: 224 }, (_, i) => i + 1));
  assert.equal(status.book.notes.length, 38);
  assert.ok(status.book.notes.every(n => !n.reviewed && n.text !== 'Fabricated note'));
  assert.equal(status.book.notes.at(-1).citations[0].page, 224);
  const reopened = new EngineeringTasks(tasks.workbench, reader);
  assert.equal((await reopened.manuals.dispatch({ action: 'status', taskId: task.id })).book.notes.length, 38);
});

test('pause preserves committed batches and resume does not duplicate their notes', { timeout: 15000 }, async t => {
  let release, blocked = false, count = 0;
  const started = new Promise(resolve => { release = resolve; });
  const reader = { interpret: async (view, _system, _prompt, signal) => {
    count++;
    if (count === 2 && !blocked) { blocked = true; release(); await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
    const block = view.blocks[0];
    return JSON.stringify({ notes: [{ text: 'Note ' + block.page, citations: [{ page: block.page, quote: block.text.trim() }] }], facts: [], unresolved: [] });
  } };
  const { tasks, file } = await fixture(t, 13, reader);
  const task = await tasks.dispatch({ action: 'create', kind: 'datasheet', left: file });
  await tasks.manuals.dispatch({ action: 'start', mode: 'book', taskId: task.id }); await started;
  const job = tasks.manuals.jobs.get(task.id);
  await tasks.manuals.dispatch({ action: 'stop', taskId: task.id }); await job.promise;
  const paused = await tasks.manuals.dispatch({ action: 'status', taskId: task.id });
  assert.equal(paused.book.state, 'paused'); assert.equal(paused.book.completedPages.length, 6);
  await tasks.manuals.dispatch({ action: 'start', mode: 'book', taskId: task.id }); await tasks.manuals.jobs.get(task.id)?.promise;
  const final = await tasks.manuals.dispatch({ action: 'status', taskId: task.id });
  assert.equal(final.book.completedPages.length, 13); assert.equal(final.book.notes.length, 3); assert.equal(count, 4);
});

test('PDF comparison is blocked until actual page recognition imports components', async t => {
  const reader = { status: async () => ({ available: true }), interpret: async view => JSON.stringify({ components: [{ ref: 'R1', value: '10k', pins: [{ number: '1' }, { number: '2' }], evidence: { page: view.page, quote: 'operating instructions', bbox: [45, 45, 100, 20] } }], nets: [], unresolved: [] }) };
  const { tasks, file } = await fixture(t, 2, reader); t.after(() => tasks.references.dispose());
  const task = await tasks.dispatch({ action: 'create', kind: 'compare', left: file, right: file });
  await assert.rejects(tasks.dispatch({ action: 'compare', taskId: task.id }), /尚未完整识别/);
  for (const side of ['left', 'right']) {
    await tasks.references.dispatch({ action: 'start', taskId: task.id, side }); await tasks.references.jobs.get(task.id)?.promise;
    const status = await tasks.references.dispatch({ action: 'status', taskId: task.id, side });
    assert.equal(status.run.state, 'complete', status.run.message); assert.deepEqual(status.run.completedPages, [1, 2]);
  }
  const compared = await tasks.dispatch({ action: 'compare', taskId: task.id });
  assert.equal(compared.right.design.components.length, 2);
  assert.equal(compared.right.design.components[1].evidence.page, 2);
  assert.equal(compared.right.design.components[1].evidence.verification, 'unverified');
  assert.notEqual(compared.comparison.conclusions.connectivity, 'pass');
});

test('text-only models cannot silently read circuit PDFs as text', async t => {
  let called = false;
  const { tasks, file } = await fixture(t, 2, { status: async () => ({ available: false, reason: '当前模型不支持图片' }), interpret: async () => { called = true; } });
  const task = await tasks.dispatch({ action: 'create', kind: 'compare', left: file, right: file });
  await assert.rejects(tasks.references.dispatch({ action: 'start', taskId: task.id, side: 'right' }), /不支持图片/);
  assert.equal(called, false); assert.equal((await tasks.load(task.id)).right.design.components.length, 0);
});

test('text remains readable when diagrams cannot be seen, and resume retries only images', async t => {
  let available = false, textCalls = 0, imageCalls = 0;
  const reader = { status: async () => ({ available, reason: 'no image model' }), interpret: async view => {
    if (view.textOnly) textCalls++; else imageCalls++;
    const block = view.blocks[0], page = block.page || view.page;
    return JSON.stringify({ notes: [{ text: view.textOnly ? 'Text note' : 'Image note', citations: [{ page, quote: block.text.trim() }] }], facts: [], unresolved: [], pageTexts: [{ page, text: 'ScannedSearchMarker' }] });
  } };
  const { tasks, file } = await fixture(t, 2, reader);
  execFileSync(python, ['-c', 'import pymupdf,sys\nd=pymupdf.open(sys.argv[1])\nfor p in d:p.draw_rect((40,40,300,100))\nd.saveIncr()', file], { windowsHide: true });
  const task = await tasks.dispatch({ action: 'create', kind: 'datasheet', left: file });
  await tasks.manuals.dispatch({ action: 'start', mode: 'book', taskId: task.id }); await tasks.manuals.jobs.get(task.id)?.promise;
  const partial = await tasks.manuals.dispatch({ action: 'status', taskId: task.id });
  assert.equal(partial.book.state, 'partial'); assert.equal(partial.book.notes.length, 1); assert.deepEqual(partial.book.skippedPages, [1, 2]);
  available = true;
  await tasks.manuals.dispatch({ action: 'start', mode: 'book', taskId: task.id }); await tasks.manuals.jobs.get(task.id)?.promise;
  const final = await tasks.manuals.dispatch({ action: 'status', taskId: task.id });
  assert.equal(final.book.state, 'complete', final.book.message); assert.equal(final.book.notes.length, 3); assert.equal(textCalls, 1); assert.equal(imageCalls, 2);
  const found = await tasks.manuals.dispatch({ action: 'search', taskId: task.id, query: 'ScannedSearchMarker' });
  assert.equal(found.total, 2); assert.match(found.items[0].quote, /ScannedSearchMarker/);
});
