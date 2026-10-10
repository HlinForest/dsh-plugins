import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { isAbsolute } from 'node:path';
import { componentGuide } from './knowledge.js';
import { review, toMarkdown } from './engine.js';
import { loadProject, exportReport } from './service.js';
import { createNotifier, startWatcher } from './watcher.js';
import { KINDS, object } from './validation.js';

export const name = 'pcb-review-assistant';
export const inject = ['tools'];
export const Config = Schema.object({
  projectFile: Schema.string().default('').description('管理员配置的 project JSON 绝对路径，描述导出网表、位置表和项目规则。'),
  reportDirectory: Schema.string().default('').description('报告导出目录绝对路径；空值禁用导出。'),
  watch: Schema.boolean().default(false).description('持续检查配置项目的导出快照变化。'),
  popup: Schema.boolean().default(false).description('watch 开启时在本机 Windows 桌面弹窗；远端 Web 浏览器不会收到桌面弹窗。'),
  pollSeconds: Schema.number().min(1).max(3600).default(3),
});
export async function apply(ctx, config) {
  for (const key of ['projectFile', 'reportDirectory']) if (config[key] && !isAbsolute(config[key])) throw new Error(`${key} 必须为绝对路径`);
  if (!Number.isInteger(config.pollSeconds)) throw new Error('pollSeconds 必须是整数');
  if (config.watch && !config.projectFile) throw new Error('启用 watch 需要 projectFile');
  let watcher;
  const register = (name, description, parameters, execute) => ctx.tools.register(defineTool({
    name, description, parameters,
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) { exec.signal?.throwIfAborted(); object(args, 'tool arguments', Object.keys(parameters)); return execute(args, exec.signal); },
  }));
  register('pcb_get_capabilities', '先调用。查看 AD/KiCad 接入方式、检查范围、配置状态。不得将建议清单称为已检测结果。', {}, async () => ({
    version: '0.1.0', runtime: 'DSH 0.2.0-rc.2', formats: ['KiCad XML 网表', 'AD Protel ASCII 网表', '统一 JSON 快照'],
    configuredProject: config.projectFile || null, reportExportEnabled: !!config.reportDirectory,
    checks: ['声明输入引脚到参考地的电容连接与 DNP', '声明电源引脚的去耦连接与 DNP', '封装参考点距离', '提供的安规测量值与项目限值比较'],
    limits: ['不读取 AD 二进制文件', '不感知 EDA 未导出的编辑', '不执行完整 DRC/铜皮路径测量', '不自动核实具体型号 datasheet', '弹窗运行在 DSH 所在 Windows 主机'],
    instructions: '器件查询用 pcb_component_guide；配置项目后用 pcb_review_project；导出需带本次 revision。snapshot JSON 来自调用者，不能视作 EDA 自动测量。',
  }));
  register('pcb_component_guide', '输入器件型号或类别，返回原理图、布局、走线、安规、工艺检查位置。明确区分通用清单与该型号 datasheet。', {
    query: { type: 'string', required: true }, kind: { type: 'string', enum: KINDS },
  }, async args => componentGuide(args.query, args.kind));
  register('pcb_inspect_project', '查看实际导出网表中的精确位号、网络名称和器件位置。ref 可选；用网络全名（包括 KiCad 层级前缀）配置检查点。', {
    ref: { type: 'string', description: '可选精确位号，例如 U1。' },
  }, async (args, signal) => {
    const { board, report } = await loadProject(config.projectFile, signal);
    if (args.ref !== undefined) {
      const component = board.components.find(c => c.ref === args.ref);
      if (!component) throw new Error(`未知位号 ${args.ref}`);
      return { revision: report.revision, component, nets: board.nets.filter(n => n.nodes.some(p => p.ref === args.ref)), notes: board.notes };
    }
    return { revision: report.revision, project: board.project, counts: report.boardCounts, components: board.components.slice(0, 200),
      nets: board.nets.slice(0, 200).map(n => ({ name: n.name, pinCount: n.nodes.length })), truncated: board.components.length > 200 || board.nets.length > 200,
      note: '总览最多 200 个器件/网络；具体器件请用 ref 查询。装配状态为导出原始状态，评审另应用项目覆盖配置。' };
  });
  register('pcb_review_project', '读取管理员配置的 AD/KiCad 导出快照，确定性评审并返回位号、网络、坐标、依据和待确认项。不能宣称整板通过。', {}, async (_args, signal) => {
    const { report } = await loadProject(config.projectFile, signal); return { ...report, markdown: toMarkdown(report) };
  });
  register('pcb_review_snapshot', '评审调用者提供的 JSON 快照（board/context，schemaVersion 1）。仅对输入数据负责；优先用 project 工具读取实际导出文件。', {
    snapshotJson: { type: 'string', required: true, description: 'JSON 对象 {board,context}；结构和示例见插件 examples。最大 2 MiB。' },
  }, async args => {
    if (Buffer.byteLength(args.snapshotJson) > 2 * 1024 * 1024) throw new Error('snapshotJson 过大');
    const data = JSON.parse(args.snapshotJson);
    if (!data || Object.keys(data).some(k => !['board', 'context'].includes(k))) throw new Error('需要 {board,context}');
    const report = review(data.board, data.context ?? {});
    report.notes.push('输入由调用者提供；未从 EDA 验证，模型整理的数据需逐项核对。');
    return { ...report, markdown: toMarkdown(report) };
  });
  register('pcb_export_report', '按当前项目重新检查，并以 expectedRevision 防止导出过期结果。输出到管理员指定目录，不覆盖已有文件。', {
    expectedRevision: { type: 'string', required: true },
  }, async (args, signal) => {
    const { report } = await loadProject(config.projectFile, signal);
    if (report.revision !== args.expectedRevision) throw new Error('项目数据已变化，请重新评审后再导出');
    return exportReport(report, config.reportDirectory, signal);
  });
  register('pcb_get_watch_status', '查看文件监听状态、最新检查问题和读取错误。监听失败不能解释为没有问题。', {}, async () => watcher?.getStatus() ?? { state: 'disabled', reason: '管理员可设置 watch=true 开启；不是 EDA 原生编辑事件监听。' });
  if (config.watch) {
    watcher = startWatcher({ projectFile: config.projectFile, pollSeconds: config.pollSeconds, notify: createNotifier({ popup: config.popup }) });
    ctx.on('dispose', () => watcher.dispose());
  }
}
