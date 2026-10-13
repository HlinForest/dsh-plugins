import Schema from '@deepseek-ai/schemastery';
import { Flow } from './service.js';
import { harnessAI } from './ai.js';
import { routes, json } from './http.js';
export const name = 'eda-flow';
export const inject = ['connection', 'tools'];
export const Config = Schema.object({
  workspaceRoot: Schema.string().required(), workDirectory: Schema.string().default(''),
  kicadPython: Schema.string().required(), kicadCli: Schema.string().required(),
  caseInputDirectory: Schema.string().default(''), allowModelCalls: Schema.boolean().default(false),
});
export function apply(ctx, config) {
  const service = new Flow(config, harnessAI(ctx)); ctx.on('dispose', () => service.close());
  for (const route of routes(service)) ctx.connection.fetch.register({ path: '/api/eda-flow/' + route.name,
    methods: route.methods, requestBody: 'buffered', fetch: async req => {
      try { return await route.run(req); } catch (e) { return json({ ok: false, error: String(e.message).slice(-5000) }, 400); }
    } });
  ctx.tools.register({ name: 'eda_flow', description: '独立工程分步流程。list/open 查看项目；update 提交阶段处理输出。工程师在页面执行、确认。R6 默认方案实际执行且不调用模型。',
    parameters: { type: 'object', properties: { request: { type: 'string', description: 'JSON: {action:list|open|create|update, projectId?, stage?, inputs?, plan?, source?}. Python plan 接受 --request。' } }, required: ['request'], additionalProperties: false },
    output: { schema: {}, render: (_a, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, execution) => service.dispatch(JSON.parse(args.request), execution.signal, 'model'),
  });
}
