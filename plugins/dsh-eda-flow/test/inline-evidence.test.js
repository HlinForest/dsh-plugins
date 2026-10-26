import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { documentEvidence } from '../src/inline-evidence.js';

const upload = { id: 'pdf-page-1', document: 'real-datasheet.pdf', page: 1, section: 'Electrical limits', content: 'Supply voltage 5 V.', simulated: false, sourceType: 'pdf-text-extraction', stages: [2, 3, 4, 5, 7] };

test('empty or non-string pasted text does not create an inline fact', () => {
  assert.deepEqual(documentEvidence({ evidence: [upload], datasheetText: '' }), [upload]);
  assert.deepEqual(documentEvidence({ evidence: [upload], datasheetText: '   \n  ' }), [upload]);
  assert.deepEqual(documentEvidence({ evidence: [upload], datasheetText: 5 }), [upload]);
  assert.deepEqual(documentEvidence({ evidence: [upload] }), [upload]);
});

test('saved text creates a stable exact-content citation without inventing a page', () => {
  const text = 'Section 4. Application circuit\nUse 5 V supply; connect C1 near VDD. (p. 4)';
  const expectedHash = createHash('sha256').update(text, 'utf8').digest('hex');
  const rows = documentEvidence({ evidence: [upload], datasheetText: text });
  assert.equal(rows.length, 2);
  const inline = rows[1];
  assert.equal(inline.id, `inline-${expectedHash.slice(0, 16)}`);
  assert.equal(inline.sourceSha256, expectedHash);
  assert.equal(inline.sourceType, 'user-provided-text');
  assert.equal(inline.document, '补充规格书正文');
  assert.equal(inline.section, '规格书正文');
  assert.equal(inline.page, null);
  assert.equal(inline.content, text);
  assert.equal(inline.simulated, false);
  assert.equal(inline.pageIsPlaceholder, false);
  assert.deepEqual(inline.stages, [2, 3, 4, 5, 7]);
  assert.deepEqual(documentEvidence({ evidence: [upload], datasheetText: text }), rows);
  assert.notEqual(documentEvidence({ evidence: [upload], datasheetText: text + ' ' })[1].id, inline.id);
});

test('existing uploaded evidence is detached and unchanged', () => {
  const original = { evidence: [upload], datasheetText: 'VCC is 5 V.' };
  const before = structuredClone(original);
  const rows = documentEvidence(original);
  rows[0].content = 'changed returned copy';
  rows[1].content = 'changed inline copy';
  assert.deepEqual(original, before);
  assert.equal(original.evidence[0].content, 'Supply voltage 5 V.');
});

test('re-running replaces only prior inline records and rejects reserved-id collisions', () => {
  const firstText = 'VCC is 5 V.';
  const first = documentEvidence({ evidence: [upload], datasheetText: firstText });
  const secondText = 'VCC is 3.3 V.';
  const second = documentEvidence({ evidence: first, datasheetText: secondText });
  assert.equal(second.filter(row => row.sourceType === 'user-provided-text').length, 1);
  assert.equal(second.find(row => row.sourceType === 'user-provided-text').content, secondText);
  const digest = createHash('sha256').update(secondText, 'utf8').digest('hex');
  assert.equal(second.find(row => row.sourceType === 'user-provided-text').id, `inline-${digest.slice(0, 16)}`);

  const conflict = { id: `inline-${digest.slice(0, 16)}`, document: 'uploaded-notes.txt', section: 'notes', content: secondText, sourceType: 'uploaded-text' };
  assert.throws(() => documentEvidence({ evidence: [conflict], datasheetText: secondText }), /ID冲突/);
});

test('clearing saved text removes stale own inline evidence but preserves uploads', () => {
  const text = 'Typed application note: use a 5 V supply.';
  const withInline = documentEvidence({ evidence: [upload], datasheetText: text });
  const cleared = documentEvidence({ evidence: withInline, datasheetText: ' \n ' });
  assert.deepEqual(cleared, [upload]);
  assert.equal(cleared.some(row => row.sourceType === 'user-provided-text'), false);
});

