import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const catalogBytes = await fs.readFile(path.join(root, '../examples/catalog.demo.json'));
const catalog = JSON.parse(catalogBytes);
const requirements = (await fs.readFile(path.join(root, '../examples/requirements.demo.txt'), 'utf8')).trim();
const prompt = `请作为麦格米特业务场景中的产品选型辅助助手，分析以下客户需求并形成中文选型报告。

本次全部产品与资料为虚构演示数据，不代表麦格米特实际产品。只能依据下方产品库，不能联网补全、编造型号、参数、认证、报价或交期。

客户需求原文：
${requirements}

请逐项比较全部五个型号：给出“通过已列条件 / 待确认 / 硬性不匹配”的结论和依据。输入电压与工作温度必须完整覆盖客户要求，区间相交不等于覆盖；未提供的参数或来源标为待确认，不能按满足处理。
如有本地产品检索、校验或报告工具，请实际调用，使用以上客户需求原文并展示不匹配产品；若没有这些工具，请直接依据下方相同资料分析。无需调用其他工具或保存文件，最终直接输出 Markdown 报告。

报告请包含：需求表、五个型号的对比表、优先候选与排除原因、参数来源 ID 和资料版本、待确认项。保留演示数据标识，说明所有结果仍需工程师确认；报价、库存、交期、温度降额和认证适用范围均未验证。

提供给两组的同一产品库 JSON：
${JSON.stringify(catalog, null, 2)}
`;
await fs.mkdir(path.join(root, 'runs'), { recursive: true });
await fs.mkdir(path.join(root, 'workspace'), { recursive: true });
await fs.writeFile(path.join(root, 'prompt.txt'), prompt, 'utf8');
await fs.writeFile(path.join(root, 'catalog.demo.json'), catalogBytes);
await fs.writeFile(path.join(root, 'requirements.txt'), requirements + '\n');
const disabled = ['tool-plugin-manager', 'tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search', 'tool-skill', 'tool-subagent-control', 'tool-subagent-list-agents', 'tool-subagent', 'tool-subagent-fork', 'tool-workflow', 'tool-todo', 'tool-goal', 'tool-ralph', 'tool-web', 'agent-instructions', 'skill-filesystem', 'session-title-llm'];
const shared = `# Identical experiment controls for both arms. No credentials are stored here.
- id: agent-default-model
  config:
    provider: deepseek-account
    model: deepseek-flash
    reasoningEffort: high
- id: llm-deepseek-account
  config:
    thinking: enabled
    reasoningEffort: high
    maxTokens: 16000
- id: system-prompt
  config:
    personaPrefix: '你是产品选型辅助助手。依据提供的资料回答，准确区分满足、不满足与资料缺失，保留来源和工程确认要求。'
    personaSuffix: ''
${disabled.map(id => `- id: ${id}\n  disabled: true`).join('\n')}
`;
await fs.writeFile(path.join(root, 'shared.patch.yml'), shared);
const manifest = {
  status: 'prepared', runtime: 'DeepSeek Harness 0.2.0-rc.2', mode: 'official headless profile',
  provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 16000,
  promptSHA256: createHash('sha256').update(prompt).digest('hex'),
  catalogSHA256: createHash('sha256').update(catalogBytes).digest('hex'),
  catalogVersion: catalog.version, fictionalData: catalog.demo,
  controls: ['Same prompt bytes including the same catalog and source evidence', 'Same model/provider/reasoning and token limit', 'Fresh sessions', 'Same shared patch and working directory', 'Only treatment profile has dsh-megmeet@0.1.0 installed', 'Generic filesystem, shell, web and delegation tools disabled in both arms'],
  limitations: ['One paired demonstration, not a statistical benchmark', 'Provider sampling defaults; no supported seed configured', 'Headless DSH runs, not desktop screenshots', 'All products and source metadata are fictional'],
};
await fs.writeFile(path.join(root, 'experiment.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ promptBytes: Buffer.byteLength(prompt), promptSHA256: manifest.promptSHA256, catalogVersion: catalog.version }));
