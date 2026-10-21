import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentProcess } from './document-process.js';
import { hash, writeJSON } from './io.js';

const script = fileURLToPath(new URL('../python/extract_pdf.py', import.meta.url));

export async function extractPdf(flow, projectId, file, binding = '') {
  const bytes = await fs.readFile(file), sha256 = hash(bytes);
  if (bytes.length > 50 * 1024 * 1024) throw new Error('单个资料文件 不能超过 50 MB。');
  const name = path.basename(file);
  const directory = path.join(flow.dir(projectId), 'documents', sha256, hash(binding).slice(0, 16));
  await fs.mkdir(directory, { recursive: true });
  const snapshot = path.join(directory, name);
  await fs.writeFile(snapshot, bytes);
  const docx = path.extname(file).toLowerCase() === '.docx';
  const extractor = docx ? fileURLToPath(new URL('../python/extract_docx.py', import.meta.url)) : script;
  const result = await documentProcess(flow.config.kicadPython, extractor, { path: snapshot, name, binding });
  return { ...result, path: snapshot, extraction: 'process-stdio', size: bytes.length };

}

export function stageEvidence(inputs, stage) {
  return (inputs.evidence || []).filter(r => r.stages?.includes(Number(stage)));
}

export async function snapshotPdfs(flow, project, output) {
  const sources = [];
  for (const attachment of project.uploads || []) {
    if (!attachment.sha256 || !attachment.extraction) continue;
    const bytes = await fs.readFile(attachment.path);
    if (hash(bytes) !== attachment.sha256) throw new Error(`资料已变化，请重新添加 PDF：${attachment.name}`);
    const target = path.join(output, 'input-snapshot', attachment.id, attachment.name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    sources.push({ name: attachment.name, binding: attachment.binding, sha256: attachment.sha256,
      pages: attachment.pages, readable: attachment.readable, unreadablePages: attachment.unreadablePages,
      snapshot: path.relative(output, target).replaceAll('\\', '/') });
  }
  if (sources.length) await writeJSON(path.join(output, 'pdf-sources.json'), sources);
}
