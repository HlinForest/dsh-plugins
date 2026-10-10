import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../lib/index.js';

async function harness(t, config = {}) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  const fiber = await ctx.plugin(plugin, config);
  let count = 0;
  const call = (name, args = {}, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, callId: `test-${++count}`, signal });
  return { ctx, fiber, call };
}

test('在真实DSH rc.2工具注册表中加载六个工具并完成端到端报告', async t => {
  const { ctx, call } = await harness(t);
  const names = ctx.tools.schemas().map(s => s.name);
  assert.equal(names.length, 6);
  assert.ok(names.includes('megmeet_generate_solution_report'));
  const info = await call('megmeet_get_catalog_info');
  assert.equal(info.isError, false);
  assert.equal(info.value.demo, true);
  const text = await readFile(new URL('../examples/requirements.demo.txt', import.meta.url), 'utf8');
  const result = await call('megmeet_generate_solution_report', { text });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.match(result.value.markdown, /DEMO-PS-A/);
  assert.equal(result.value.analysis.candidates.length, 2);
  assert.equal(result.value.humanReviewRequired, true);
  assert.equal(JSON.parse(result.content[0].text).demo, true);
});

test('通过真实执行管线拒绝非法参数、伪造产品和无来源补充约束', async t => {
  const { call } = await harness(t, { maxCandidates: 2 });
  for (const [name, args] of [
    ['megmeet_parse_requirements', { text: 42 }],
    ['megmeet_search_products', { text: '需求', limit: 3 }],
    ['megmeet_validate_candidate', { text: '需求', productId: 'FAKE' }],
    ['megmeet_generate_solution_report', { text: '需求', productIds: ['DEMO-PS-A', 'DEMO-PS-A'] }],
    ['megmeet_parse_requirements', { text: '需求', constraints: [{ field: 'output_power_w', operator: 'gte', value: 3000, sourceQuote: '伪造引用' }] }],
    ['megmeet_parse_requirements', { text: '需求', constraints: [{ field: 'output_power_w', operator: 'gte', value: 3000, sourceQuote: '需求', tenantId: 'spoof' }] }],
  ]) {
    const result = await call(name, args);
    assert.equal(result.isError, true, `${name}: ${JSON.stringify(args)}`);
  }
});

test('显式选中硬性不匹配产品时报告如实列出差异', async t => {
  const { call } = await harness(t);
  const result = await call('megmeet_generate_solution_report', { text: '输出功率：≥3000W', productIds: ['DEMO-PS-B'] });
  assert.equal(result.isError, false);
  assert.equal(result.value.analysis.candidates[0].status, 'incompatible');
  assert.match(result.value.markdown, /不匹配/);
});

test('取消调用得到标准错误，卸载插件后工具全部注销', async t => {
  const { ctx, fiber, call } = await harness(t);
  const abort = new AbortController();
  abort.abort();
  const result = await call('megmeet_get_catalog_info', {}, abort.signal);
  assert.equal(result.isError, true);
  await fiber.dispose();
  assert.equal(ctx.tools.schemas().length, 0);
});

test('无效配置在加载时失败，不能带错误产品库上线', async t => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await assert.rejects(Promise.resolve(ctx.plugin(plugin, { maxCandidates: 0 })));
  await assert.rejects(Promise.resolve(ctx.plugin(plugin, { catalogPath: 'relative.json' })));
});
