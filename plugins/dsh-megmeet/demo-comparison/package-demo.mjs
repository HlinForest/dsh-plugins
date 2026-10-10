import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from '../node_modules/js-yaml/index.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const credentialPath = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE, '.dsh'), '.credentials.yaml');
const doc = yaml.load(await fs.readFile(credentialPath, 'utf8'));
const secrets = new Set();
function visit(value, key = '') {
  if (typeof value === 'string' && /token|secret|password|key/i.test(key) && value.length >= 12) secrets.add(value);
  if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) visit(item, name);
}
visit(doc.records);
for (const value of Object.values(doc.refs ?? {})) if (typeof value === 'string' && value.length >= 12) secrets.add(value);
const files = [];
async function list(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (['replays', '__pycache__', 'workspace'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await list(filename); else files.push(filename);
  }
}
await list(root);
for (const filename of files) {
  const contents = await fs.readFile(filename);
  for (const secret of secrets) if (contents.includes(Buffer.from(secret, 'utf8'))) throw new Error('Credential value detected in artifact: ' + path.relative(root, filename));
}
const verification = JSON.parse(await fs.readFile(path.join(root, 'verification.json'), 'utf8'));
verification.credentialValuesAbsentFromArtifacts = true;
verification.offlinePageChecks = JSON.parse(await fs.readFile(path.join(root, 'page-verification.json'), 'utf8'));
await fs.writeFile(path.join(root, 'verification.json'), JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify({ artifactFileCount: files.length, credentialValuesAbsent: true }));
