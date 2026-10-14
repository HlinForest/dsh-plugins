import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = new URL('../', import.meta.url);
const read = relative => fs.readFile(new URL(relative, root), 'utf8');
const parts = ['core', 'helpers', 'visuals', 'selection', 'pcb', 'schematic', 'materials', 'manual-reader', 'reference-reader', 'engineering', 'restoration', 'shell'];
const body = [];
for (const part of parts) body.push(await read(`client/${part}.js`));
const content = body.join('\n').replace("const R = require('react');", "import R from 'react';\nimport { createRoot } from 'react-dom/client';");
await fs.mkdir(new URL('web/', root), { recursive: true });
await build({ stdin: { contents: content, resolveDir: fileURLToPath(root), sourcefile: 'workbench.js' },
  outfile: fileURLToPath(new URL('web/app.js', root)), bundle: true, minify: true, platform: 'browser',
  format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof' });
await fs.copyFile(new URL('client/styles.css', root), new URL('web/styles.css', root));
await fs.copyFile(new URL('client/page.html', root), new URL('web/page.html', root));
await fs.copyFile(new URL('client/host.js', root), new URL('client.js', root));
const hash = createHash('sha256');
for (const file of ['web/app.js', 'web/styles.css', 'web/page.html', 'client.js', 'desktop/main.cjs', 'desktop/preload.cjs', 'src/window.js', 'src/index.js']) hash.update(await read(file));
const { version } = JSON.parse(await read('package.json'));
await fs.writeFile(new URL('src/build.json', root), JSON.stringify({ version, build: hash.digest('hex').slice(0, 16) }) + '\n');
