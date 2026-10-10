import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import yaml from '../../node_modules/js-yaml/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE, '.dsh');
const credentials = yaml.load(await fs.readFile(path.join(privateHome, '.credentials.yaml'), 'utf8'));
const secrets = new Set();
function visit(value, key = '') {
  if (typeof value === 'string' && /token|secret|password|key/i.test(key) && value.length >= 12) secrets.add(value);
  if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) visit(item, name);
}
visit(credentials.records);
for (const value of Object.values(credentials.refs ?? {})) {
  if (typeof value === 'string' && value.length >= 12) secrets.add(value);
}
const excluded = new Set(['__pycache__', 'workspace', 'replays', 'node_modules', 'web-profile.yml']);
const files = [];
async function list(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await list(filename);
    else if (!entry.name.endsWith('.zip')) files.push(filename);
  }
}
await list(root);
const projectRoot = path.dirname(root);
for (const directory of ['src', 'lib', 'test', 'examples', 'scripts']) await list(path.join(projectRoot, directory));
for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'cordis.patch.yml', 'README.md', 'LICENSE']) files.push(path.join(projectRoot, name));
const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
files.push(path.join(projectRoot, `dsh-megmeet-${pkg.version}.tgz`));
for (const filename of files) {
  const bytes = await fs.readFile(filename);
  const contents = filename.endsWith('.tgz') ? gunzipSync(bytes) : bytes;
  for (const secret of secrets) {
    if (contents.includes(Buffer.from(secret, 'utf8'))) {
      throw new Error('Credential value detected in artifact: ' + path.relative(root, filename));
    }
  }
}
const verificationPath = path.join(root, 'verification.json');
const verification = JSON.parse(await fs.readFile(verificationPath, 'utf8'));
verification.credentialValuesAbsentFromArtifacts = true;
verification.offlinePageChecks = JSON.parse(await fs.readFile(path.join(root, 'page-verification.json'), 'utf8'));
await fs.writeFile(verificationPath, JSON.stringify(verification, null, 2) + '\n');
console.log(JSON.stringify({ artifactFileCount: files.length, credentialValuesAbsent: true }));
