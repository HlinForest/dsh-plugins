import Schema from '@deepseek-ai/schemastery';
import { Flow } from './service.js';
import { harnessAI } from './ai.js';
import { routes, json } from './http.js';
import { DesignWindow } from './window.js';
import { PreciseTools } from './precise-tools.js';
export const name = 'eda-flow';
export const inject = ['connection', 'tools'];
export const Config = Schema.object({
  workspaceRoot: Schema.string().required(), workDirectory: Schema.string().default(''),
  kicadPython: Schema.string().required(), kicadCli: Schema.string().required(),
  mcpPython: Schema.string().default(''),
  allowModelCalls: Schema.boolean().default(true),
});
export function apply(ctx, config) {
  const mcp = new PreciseTools(config, ctx); mcp.register();
  const service = new Flow(config, harnessAI(ctx), mcp), designWindow = new DesignWindow(service);
  service.openWindow = () => designWindow.open();
  ctx.on('dispose', async () => { await designWindow.close(); await service.close(); });
  for (const route of routes(service)) ctx.connection.fetch.register({ path: '/api/eda-flow/' + route.name,
    methods: route.methods, requestBody: 'buffered', fetch: async req => {
      try { return await route.run(req); } catch (e) { return json({ ok: false, error: String(e.message).slice(-5000), errorInfo: { code: e.code, details: e.details } }, 400); }
    } });
  ctx.tools.register({ name: 'eda_flow', description: '纯文字需求经模型与 KiCad MCP 生成原理图。list/open 查看，records 查询记录，rename 改名，update 补充文字。create 可用 caseId:display-board 预填公开文字任务书；工程师在页面发起模型处理并确认下一步。PCB 本轮未执行。',
    parameters: { type: 'object', properties: { request: { type: 'string', description: 'JSON: {action:list|open|create|update|read|records|rename, projectId?, label?, stage?, inputs?, caseId?, scope?:inputs|prepared|stage:数字,path?,offset?,length?}。' } }, required: ['request'], additionalProperties: false },
    output: { schema: {}, render: (_a, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, execution) => service.dispatch(JSON.parse(args.request), execution.signal, 'model'),
  });
}
