import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const arm = process.argv[2];
if (!['baseline', 'plugin'].includes(arm)) throw new Error('Usage: node run.mjs baseline|plugin');
const outputRoot = process.argv[3] ? path.resolve(process.argv[3]) : root;
await fs.mkdir(path.join(outputRoot, 'runs'), { recursive: true });
const cli = path.join(root, '../.verification/dsh-host/node_modules/@deepseek-ai/dsh/lib/bin.js');
const profile = arm === 'baseline' ? 'megmeet-real-base' : 'megmeet-real-plugin';
const prompt = await fs.readFile(path.join(root, 'prompt.txt'));
const startedAt = new Date().toISOString();
const args = [cli, '--profile', profile, '--patch', path.join(root, 'shared.patch.yml'), '--json', '-'];
if (arm === 'plugin') args.splice(args.length - 2, 0, '--patch', path.join(root, 'plugin.patch.yml'));
const child = spawn(process.execPath, args, {
  cwd: path.join(root, 'workspace'), windowsHide: true,
  env: { ...process.env, DSH_HOME: process.env.DSH_HOME || path.join(process.env.USERPROFILE, '.dsh'), DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stdout = '', stderr = '', pending = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
const events = [];
const timeout = setTimeout(() => { console.error('Run timed out after 12 minutes.'); child.kill(); }, 12 * 60 * 1000);
child.stdout.on('data', chunk => {
  const text = chunk.toString('utf8'); stdout += text; pending += text;
  let newline;
  while ((newline = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
    try {
      const event = JSON.parse(line); events.push(event);
      if (event.type === 'session') console.log(`${arm}: new session ${event.sessionId}`);
      if (event.type === 'tool_call') console.log(`${arm}: tool ${event.tool}`);
      if (event.type === 'status' && event.phase === 'step_end') console.log(`${arm}: step complete`);
      if (event.type === 'error') console.error(`${arm}: ${event.message}`);
      if (event.type === 'final') console.log(`${arm}: final received (${event.text.length} characters)`);
    } catch { /* Keep non-JSON diagnostics in the raw file. */ }
  }
});
child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
child.stdin.end(prompt);
const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
clearTimeout(timeout);
await fs.writeFile(path.join(outputRoot, 'runs', `${arm}.events.jsonl`), stdout);
await fs.writeFile(path.join(outputRoot, 'runs', `${arm}.stderr.txt`), stderr);
const final = events.findLast(e => e.type === 'final');
const usage = events.filter(e => e.type === 'status' && e.phase === 'step_end' && e.usage).map(e => e.usage);
const result = {
  arm, profile, startedAt, finishedAt: new Date().toISOString(), exitCode,
  success: exitCode === 0 && !!final?.text,
  sessionId: events.find(e => e.type === 'session')?.sessionId,
  promptSHA256: createHash('sha256').update(prompt).digest('hex'),
  toolCalls: events.filter(e => e.type === 'tool_call').map(e => ({ name: e.tool, input: e.input, callId: e.callId })),
  errors: events.filter(e => e.type === 'error'), usage,
};
await fs.writeFile(path.join(outputRoot, 'runs', `${arm}.metadata.json`), JSON.stringify(result, null, 2) + '\n');
if (final?.text) await fs.writeFile(path.join(outputRoot, `${arm}.md`), final.text + '\n');
console.log(JSON.stringify({ arm, success: result.success, exitCode, toolCalls: result.toolCalls.map(t => t.name) }));
if (!result.success) { console.error(stderr.slice(-5000)); process.exitCode = 1; }
