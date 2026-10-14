import Schema from '@deepseek-ai/schemastery';
import { Flow } from './service.js';
import { harnessAI } from './ai.js';
import { routes, json } from './http.js';
import { DesignWindow } from './window.js';
export const name = 'eda-flow';
export const inject = ['connection', 'tools'];
export const Config = Schema.object({
  workspaceRoot: Schema.string().required(), workDirectory: Schema.string().default(''),
  kicadPython: Schema.string().required(), kicadCli: Schema.string().required(),
  allowModelCalls: Schema.boolean().default(true),
});
export function apply(ctx, config) {
  const service = new Flow(config, harnessAI(ctx)), designWindow = new DesignWindow(service);
  service.openWindow = () => designWindow.open();
  ctx.on('dispose', async () => { await designWindow.close(); await service.close(); });
  for (const route of routes(service)) ctx.connection.fetch.register({ path: '/api/eda-flow/' + route.name,
    methods: route.methods, requestBody: 'buffered', fetch: async req => {
      try { return await route.run(req); } catch (e) { return json({ ok: false, error: String(e.message).slice(-5000), errorInfo: { code: e.code, details: e.details } }, 400); }
    } });
  ctx.tools.register({ name: 'eda_flow', description: '原理图与 PCB 分步设计。list/open 查看，records 查询记录，rename 改名，read 分段读完整输入，update 补充资料。create 可用 caseId:display-board 预填显示板输入；工程师在页面发起模型处理并确认下一步。',
    parameters: { type: 'object', properties: { request: { type: 'string', description: 'JSON: {action:list|open|create|update|read|records|rename, projectId?, label?, stage?, inputs?, caseId?, scope?:inputs|prepared|stage:数字,path?,offset?,length?}。' } }, required: ['request'], additionalProperties: false },
    output: { schema: {}, render: (_a, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, execution) => service.dispatch(JSON.parse(args.request), execution.signal, 'model'),
  });
}
