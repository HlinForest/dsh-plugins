import fs from 'node:fs/promises';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import yaml from '../node_modules/js-yaml/index.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = process.argv[2] ? path.resolve(process.argv[2]) : root;
const jsType = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ expression: value }) });
const schema = yaml.DEFAULT_SCHEMA.extend([jsType]);
const configs = {};
for (const arm of ['baseline', 'plugin']) configs[arm] = yaml.load(await fs.readFile(path.join(outputRoot, 'runs', `${arm}.config.yml`), 'utf8'), { schema });
const ids = new Set([...configs.baseline, ...configs.plugin].map(row => row.id));
const differences = [];
for (const id of ids) {
  const baseline = configs.baseline.find(row => row.id === id);
  const plugin = configs.plugin.find(row => row.id === id);
  if (JSON.stringify(baseline) !== JSON.stringify(plugin)) differences.push({ id, baseline: baseline ?? null, plugin: plugin ?? null });
}
if (differences.length !== 1 || differences[0].id !== 'megmeet-product-assistant') throw new Error('Unexpected configuration difference: ' + differences.map(d => d.id).join(', '));
await fs.writeFile(path.join(outputRoot, 'runs', 'config-difference.json'), JSON.stringify(differences, null, 2) + '\n');

const project = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE, '.dsh'), 'sessions', '--D-VisualBoard-dsh-megmeet-demo-comparison-workspace--');
for (const arm of ['baseline', 'plugin']) {
  const metadata = JSON.parse(await fs.readFile(path.join(outputRoot, 'runs', `${arm}.metadata.json`), 'utf8'));
  const sessionDirectory = path.join(project, metadata.sessionId);
  const files = (await fs.readdir(sessionDirectory)).filter(name => /\.jsonl(?:\.zstd)?$/.test(name));
  const records = [];
  for (const filename of files) {
    let bytes = await fs.readFile(path.join(sessionDirectory, filename));
    if (filename.endsWith('.zstd')) {
      const chunks = [];
      let offset = 0;
      while (offset < bytes.length) {
        const decoded = zstdDecompressSync(bytes.subarray(offset), { info: true });
        if (decoded.engine.bytesWritten <= 0) throw new Error('Zstandard frame did not advance.');
        offset += decoded.engine.bytesWritten;
        chunks.push(decoded.buffer);
      }
      bytes = Buffer.concat(chunks);
    }
    for (const line of bytes.toString('utf8').split('\n').filter(Boolean)) records.push(JSON.parse(line));
  }
  // Export only explicit public-demo event types. Do not export raw headers, credentials or arbitrary session fields.
  const events = records.map(record => record.event ?? record).filter(event => ['tool/call', 'tool/result'].includes(event.type));
  await fs.writeFile(path.join(outputRoot, 'runs', `${arm}.session-evidence.json`), JSON.stringify(events, null, 2) + '\n');
  const contexts = records.filter(record => record.type === 'request/context').map(record => record.data);
  const userMessages = records.filter(record => record.type === 'user/message').map(record => {
    const content = (record.data.message ?? record.data).content;
    if (!Array.isArray(content)) throw new Error('Unexpected persisted user-message content shape: ' + Object.keys(record.data).join(', '));
    return content.filter(block => block.type === 'text').map(block => block.text).join('');
  });
  const runtimeEvidence = {
    models: contexts.map(context => ({ provider: context.provider, model: context.model, contextWindow: context.contextWindow })),
    persistedPromptSHA256: userMessages.map(text => createHash('sha256').update(text).digest('hex')),
    toolCalls: events.filter(event => event.type === 'tool/call').length,
    toolResults: events.filter(event => event.type === 'tool/result').length,
  };
  if (arm === 'plugin') {
    const pluginDirectory = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE, '.dsh'), 'profiles', metadata.profile, 'node_modules', 'dsh-megmeet');
    const pkg = JSON.parse(await fs.readFile(path.join(pluginDirectory, 'package.json'), 'utf8'));
    runtimeEvidence.installedPlugin = `${pkg.name}@${pkg.version}`;
    const actualCatalog = await fs.readFile(path.join(pluginDirectory, 'examples', 'catalog.demo.json'));
    const inputCatalog = await fs.readFile(path.join(outputRoot, 'catalog.demo.json'));
    runtimeEvidence.catalogMatchesPromptData = actualCatalog.equals(inputCatalog);
    if (!runtimeEvidence.catalogMatchesPromptData) throw new Error('Installed catalog differs from shared input.');
  }
  await fs.writeFile(path.join(outputRoot, 'runs', `${arm}.runtime-evidence.json`), JSON.stringify(runtimeEvidence, null, 2) + '\n');
  console.log(JSON.stringify({ arm, ...runtimeEvidence }));
  console.log(JSON.stringify({ arm, files, recordCount: records.length, eventTypes: [...new Set(records.map(r => (r.event ?? r).type))], extractedEventCount: events.length, sampleKeys: records.slice(0, 2).map(r => Object.keys(r)) }));
}
