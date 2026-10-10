import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
const [profileDirectory, configPath] = process.argv.slice(2);
if (!path.isAbsolute(profileDirectory ?? '') || !path.isAbsolute(configPath ?? '')) throw new Error('Absolute profile and config paths required.');
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const allowed = ['serverEntry', 'nodeCommand', 'kicadCli', 'kicadPython', 'workspaceRoot', 'backend', 'toolTimeoutMs'];
if (Object.keys(config).some(k => !allowed.includes(k))) throw new Error('Unexpected configuration key.');
for (const key of allowed.slice(0, 5)) {
  if (!path.isAbsolute(config[key] ?? '')) throw new Error(key + ' must be absolute.');
  const stat = await fs.stat(config[key]);
  if (key === 'workspaceRoot' ? !stat.isDirectory() : !stat.isFile()) throw new Error('Missing ' + key);
}
if (!['swig', 'auto', 'ipc'].includes(config.backend)) throw new Error('Invalid backend.');
if (!Number.isInteger(config.toolTimeoutMs) || config.toolTimeoutMs < 1000 || config.toolTimeoutMs > 1800000) throw new Error('Invalid timeout.');
const target = path.join(profileDirectory, 'cordis.patch.yml');
const before = await fs.readFile(target, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
// Native DSH initializes an empty overlay as `[]`; a block sequence cannot
// be appended after that standalone flow-sequence document.
const base = before.replace(/^\[\][ \t]*\r?$/gm, '');
const begin = '# BEGIN DSH_KICAD_WORKFLOW'; const end = '# END DSH_KICAD_WORKFLOW';
const body = begin + '\n' + yaml.dump([{ id: 'kicad-workflow', config }], { lineWidth: -1, noRefs: true }) + end;
let after;
if (base.includes(begin)) {
  const start = base.indexOf(begin), finish = base.indexOf(end, start);
  if (finish < 0 || base.indexOf(begin, start + begin.length) >= 0) throw new Error('Ambiguous managed configuration block.');
  after = base.slice(0, start) + body + base.slice(finish + end.length);
} else {
  if (/^\s*-\s*id:\s*['"]?kicad-workflow\b/m.test(base)) throw new Error('An unmanaged kicad-workflow row already exists; merge its config explicitly.');
  after = base.trimEnd() + '\n' + body + '\n';
}
if (before) await fs.writeFile(target + '.kicad-backup-' + Date.now(), before, { flag: 'wx' });
await fs.writeFile(target, after, 'utf8');
console.log(JSON.stringify({ configured: true, profileDirectory, config: { backend: config.backend, workspaceRoot: config.workspaceRoot } }));
