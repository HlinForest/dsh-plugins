import fs from 'node:fs/promises';
import { Flow } from '../src/service.js';
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
config.allowModelCalls = false;
const service = new Flow(config, { generate() { throw new Error('Unexpected paid-model call'); } });
let project = await service.create({ caseId: 'r6', label: 'R6 默认流程独立验收' });
process.stdout.write(`Project ${project.id}\n`);
for (let stage = 1; stage <= 7; stage++) {
  project = await service.execute(project.id, stage, new AbortController().signal);
  project = await service.confirm({ projectId: project.id, stage, allowDraft: true, note: '自动验收脚本模拟界面确认；非公司签核。' }, 'human');
  process.stdout.write(`Stage ${stage}: ${project.stages[stage - 1].result.summary}\n`);
}
const replay = await service.replay(project.id);
await fs.writeFile(process.argv[3], JSON.stringify({ projectId: project.id, projectDirectory: service.dir(project.id), modelRequests: project.modelRequests, replay }, null, 2));
process.stdout.write(JSON.stringify(replay) + '\n');
if (!replay.match) process.exitCode = 1;
