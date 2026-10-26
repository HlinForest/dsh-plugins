import { createHash } from 'node:crypto';

const inlineDocument = '补充规格书正文';
const inlineSection = '规格书正文';
const inlineStages = [2, 3, 4, 5, 7];

const isOwnInlineRecord = record => record && record.sourceType === 'user-provided-text'
  && record.document === inlineDocument && record.section === inlineSection;

/**
 * Merge the project's uploaded evidence with the saved free-form datasheet
 * text. The returned array is detached from inputs, and the text record is
 * deliberately marked as user-provided rather than as extracted PDF data.
 */
export function documentEvidence(inputs = {}) {
  const existing = Array.isArray(inputs?.evidence) ? structuredClone(inputs.evidence) : [];
  const savedText = inputs?.datasheetText;
  if (typeof savedText !== 'string' || !savedText.trim()) return existing.filter(row => !isOwnInlineRecord(row));

  const sourceSha256 = createHash('sha256').update(savedText, 'utf8').digest('hex');
  const id = `inline-${sourceSha256.slice(0, 16)}`;
  const record = {
    id,
    sourceType: 'user-provided-text',
    document: inlineDocument,
    section: inlineSection,
    page: null,
    content: savedText,
    simulated: false,
    pageIsPlaceholder: false,
    stages: [...inlineStages],
    sourceSha256,
  };

  // Uploaded records are authoritative and are never rewritten. A row using
  // our reserved id is safe only when it is one of our own previous inline
  // records; otherwise fail closed instead of silently changing provenance.
  const collision = existing.find(row => row?.id === id && !isOwnInlineRecord(row));
  if (collision) throw new Error(`内联规格正文引用ID冲突：${id}`);

  // Replace prior inline text rows so changing the saved text cannot leave a
  // stale citation beside the current one. This only removes records carrying
  // the explicit user-provided-text marker and reserved document metadata.
  const retained = existing.filter(row => !isOwnInlineRecord(row));
  retained.push(record);
  return retained;
}

