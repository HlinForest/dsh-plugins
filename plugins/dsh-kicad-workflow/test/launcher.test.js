import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

test('launcher forwards discovery immediately but holds tool calls for backend READY', { timeout: 10000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kicad-proxy-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const server = path.join(dir, 'server.mjs');
  await fs.writeFile(server, `import readline from 'node:readline'; let ready=false; setTimeout(()=>{ready=true;process.stderr.write('KiCAD MCP SERVER READY\\n')},400);readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{ready}})+'\\n')});`);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/mcp-launcher.mjs', import.meta.url)), server], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.on('close', resolve));
  t.after(async () => { child.stdin.end(); await exited; });
  const input = readline.createInterface({ input: child.stdout });
  const rows = [];
  const gotBoth = new Promise((resolve, reject) => {
    input.on('line', line => { rows.push(JSON.parse(line)); if (rows.length === 2) resolve(); });
    child.on('error', reject);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call' }) + '\n');
  await gotBoth;
  assert.deepEqual(rows.map(x => [x.id, x.result.ready]), [[1, false], [2, true]]);
});
