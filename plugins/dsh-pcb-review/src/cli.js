#!/usr/bin/env node
import { resolve } from 'node:path';
import { loadProject, exportReport } from './service.js';
import { toMarkdown } from './engine.js';
import { componentGuide } from './knowledge.js';
import { createNotifier, startWatcher } from './watcher.js';

async function main() {
  const [command, input, ...rest] = process.argv.slice(2);
  if (command === 'guide' && input) { console.log(JSON.stringify(componentGuide(input, rest[0]), null, 2)); return; }
  if (command === 'review' && input) {
    const { report } = await loadProject(resolve(input));
    console.log(toMarkdown(report));
    if (rest[0] === '--out' && rest[1]) console.log(JSON.stringify(await exportReport(report, resolve(rest[1]))));
    return;
  }
  if (command === 'watch' && input) {
    const watcher = startWatcher({ projectFile: resolve(input), notify: createNotifier({ popup: rest.includes('--popup') }) });
    const keepAlive = setInterval(() => {}, 60000);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { watcher.dispose(); clearInterval(keepAlive); });
    console.log('正在监听导出快照；连续两次一致后提醒新增或变化的问题。Ctrl+C 停止。'); return;
  }
  console.log('pcb-review guide "STM32" [mcu]\npcb-review review project.json [--out reports]\npcb-review watch project.json [--popup]');
  process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
