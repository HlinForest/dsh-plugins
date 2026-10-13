import fs from 'node:fs/promises';
import path from 'node:path';
import { Flow } from '../src/service.js';
const config = JSON.parse((await fs.readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
config.allowModelCalls = false;
const flow = new Flow(config);
const p = await flow.create({ caseId: 'r6', label: 'R6 默认方案 · 自动验收' });
for (let stage = 1; stage <= 7; stage++) {
  process.stdout.write(`Stage ${stage}: running\n`);
  const state = await flow.execute(p.id, stage);
  // Automated test acknowledgment, explicitly distinguished from company approval.
  await flow.confirm({ projectId: p.id, stage, allowDraft: true, note: '自动验收中的技术草稿确认；不代替工程师或公司签核。' }, 'human');
  process.stdout.write(`Stage ${stage}: ${state.stages[stage - 1].result.summary}\n`);
}
const replay = await flow.replay(p.id);
const result = { projectId: p.id, projectDirectory: flow.dir(p.id), modelRequests: 0, replay };
const file = process.argv[3] || path.join(config.workDirectory, 'default-validation.json');
await fs.writeFile(file, JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (!replay.match) process.exitCode = 1;
