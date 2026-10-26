import { createHash } from 'node:crypto';
import {documentEvidence} from './inline-evidence.js';
import {unsupportedQuantities} from './evidence-quantities.js';

// Application guidance is deliberately kept separate from componentFacts.  A
// fact describes a part and its pins; this module records source-backed usage
// information that the design stage may use when choosing a circuit.
export const applicationInstructions = `从当前可读规格资料中提取应用层事实，使用spec_record_guidance分批提交，每批guidance最多5条；也可以只提交removeIds撤回错误事实，但每批至少有一条guidance或一个removeId。每条guidance格式为：
{subject,category,statement,citations:[{sourceId,quote}]}。
category只能是supply、interface、peripheral、limits、unused-pin或application。只记录资料明确写出的供电要求、串行/控制接口用法、推荐外围、未使用引脚处理、工作限制及应用说明；statement必须能由引用原文直接支持。每个电气数值都须包含在本条citations中，宿主按单位换算核对；不能只引用同页其他内容来支持未引用数值。保留器件或模块在资料中的称呼，不要求特定器件、型号或引脚映射。
request.applicationCoverage列出原页中可识别的明确阻容数值线索。它是最小提取覆盖检查，不是强制本项目照搬示例。完成前须将这些数值、用途与适用条件记入带引用的guidance；仅引用整页但在statement中不记录数值仍会被判为遗漏。记录推荐方案与最终采用方案分开，是否不采用及其理由留在第三步，不得把资料已给出的值说成“未提供”。
引用必须来自本轮inputs.evidence，quote是对应文档正文或表格展开记录中的逐字片段；宿主会补充document、page、section和simulated来源标记。pdf-table-extraction保留表格前文、行列和明确单位列；它只恢复单元格关系，不证明额定语义。提取电气参数时同时保留参数名、最小/典型/最大列及测试条件；不能把测试条件中的电压当成驱动压降，不能把极限额定当成推荐工作值，不能只引用数字而丢弃适用条件。单位或表头不清楚的项保留待核实。不能引用坐标、外形/几何、脚本、网表、CAD对象或其他工程生成物，也不能把模型的推断、通用经验或待定设计选择写成厂家资料事实。若需要提出电路方案或器件选型，请放到assumptions、第三步design及待确认项，不要混入guidance或步骤2的requirements。资料没有明确说明时保留缺项，不用语义推断补齐。新事实省略id；宿主返回accepted id后，修正同一事实时在该条带上原id，宿主会替换旧条目。资料判断错误时使用removeIds撤回对应accepted id，不要静默重复提交。`;

export const applicationTool = {
  name: 'spec_record_guidance',
  description: '逐批保存或更正当前规格资料中有逐字来源的应用指导事实。guidance每次最多5条；新条目省略id，修正条目使用已accepted的id替换旧条目；removeIds最多5个，用于撤回错误事实。至少提供一条guidance或一个removeId；只收录供电、接口、推荐外围、未用脚处理、限制和应用说明，不接受几何、脚本、网表或模型设计选择。',
  inputSchema: {
    type: 'object',
    properties: {
      guidance: {
        type: 'array',
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', minLength: 1, pattern: '^guidance-[0-9a-f]{16}$' },
            subject: { type: 'string', minLength: 1 },
            category: { type: 'string', enum: ['supply', 'interface', 'peripheral', 'limits', 'unused-pin', 'application'] },
            statement: { type: 'string', minLength: 1 },
            citations: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: { sourceId: { type: 'string' }, quote: { type: 'string', minLength: 1 } },
                required: ['sourceId', 'quote'],
                additionalProperties: false,
              },
            },
          },
          required: ['subject', 'category', 'statement', 'citations'],
          additionalProperties: false,
        },
      },
      removeIds: {
        type: 'array',
        maxItems: 5,
        uniqueItems: true,
        items: { type: 'string', minLength: 1, pattern: '^guidance-[0-9a-f]{16}$' },
      },
    },
    anyOf: [
      { required: ['guidance'], properties: { guidance: { minItems: 1 } } },
      { required: ['removeIds'], properties: { removeIds: { minItems: 1 } } },
    ],
    additionalProperties: false,
  },
};

const categories = new Set(['supply', 'interface', 'peripheral', 'limits', 'unused-pin', 'application']);
const itemKeys = new Set(['id', 'subject', 'category', 'statement', 'citations']);
const citationKeys = new Set(['sourceId', 'quote']);
const guidanceIdPattern = /^guidance-[0-9a-f]{16}$/;

const compact = value => String(value)
  .replace(/\r\n?/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/ *\n */g, ' ')
  .trim();

const text = value => typeof value === 'string' ? value.trim() : '';

// Stable object encoding keeps ids independent of JavaScript object key order.
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value;
}

function guidanceId(item) {
  const identity = {
    subject: item.subject,
    category: item.category,
    statement: item.statement,
    citations: item.citations.map(c => ({ sourceId: c.sourceId, quote: c.quote })).sort((a, b) => `${a.sourceId}\u0000${a.quote}`.localeCompare(`${b.sourceId}\u0000${b.quote}`)),
  };
  return 'guidance-' + createHash('sha256').update(JSON.stringify(stableValue(identity))).digest('hex').slice(0, 16);
}

function nonApplicationSource(source, quote) {
  const metadata = [source.sourceType, source.document, source.section, source.binding].filter(Boolean).join(' ');
  // Keep the exclusion narrow: a normal datasheet can mention a board, but a
  // CAD/script/netlist record is not a source for application-level guidance.
  if (/(?:netlist|script|gerber|gds|kicad[_. -]?(?:pcb|sch)|(?:^|[\\/])[^\\/]*\.(?:py|kicad_pcb|kicad_sch|net))\b/i.test(metadata)) return true;
  const body = compact(quote);
  return /\b(?:netlist|gerber|gds|kicad[_. -]?(?:pcb|sch))\b/i.test(body)
    || /(?:<script\b|```|(?:^|\s)def\s+[A-Za-z_]\w*\s*\(|(?:^|\s)class\s+[A-Za-z_]\w*\s*[:(]|(?:^|\s)import\s+[A-Za-z_][\w.]*|(?:^|\s)from\s+[A-Za-z_][\w.]*\s+import|(?:^|[\s,{"'])['"]?(?:x|y)['"]?\s*[=:]\s*[-+]?\d(?:[\d.]*))/i.test(body);
}

function sourceFor(id, evidence) {
  return evidence.find(source => source && source.id === id);
}

function validateCitation(citation, evidence, subject) {
  if (!citation || typeof citation !== 'object' || Array.isArray(citation) || Object.keys(citation).some(key => !citationKeys.has(key))) throw new Error(`应用指导引用格式无效：${subject}`);
  const sourceId = text(citation.sourceId), quote = text(citation.quote);
  const source = sourceFor(sourceId, evidence);
  if (!source || typeof source.content !== 'string') throw new Error(`应用指导引用的资料来源不存在：${subject}`);
  if (!quote || compact(quote).length < 8 || !compact(source.content).includes(compact(quote))) throw new Error(`应用指导引用未匹配当前资料原文：${subject}`);
  if (nonApplicationSource(source, quote)) throw new Error(`应用指导不能引用几何、脚本或网表资料：${subject}`);
  return {
    sourceId,
    quote,
    document: source.document ?? null,
    page: source.page ?? null,
    section: source.section ?? null,
    simulated: source.simulated === true,
  };
}

/**
 * Validate and enrich source-cited application guidance from the current
 * evidence set. The model tool submits at most five rows per call; callers
 * may pass several accepted batches when materialising a stage result.
 */
export function extractGuidance(plan, inputs = {}) {
  if (!plan || typeof plan !== 'object') return [];
  const hasGuidance = plan.guidance !== undefined;
  const hasRemoveIds = plan.removeIds !== undefined;
  if (!hasGuidance && !hasRemoveIds) return [];
  const guidance = hasGuidance ? plan.guidance : [];
  const removeIds = hasRemoveIds ? plan.removeIds : [];
  if (!Array.isArray(guidance) || guidance.length > 200) throw new Error('guidance必须为最多200条应用资料事实。');
  if (!Array.isArray(removeIds) || removeIds.length > 5) throw new Error('removeIds必须为最多5个已接受的应用指导ID。');
  if (new Set(removeIds).size !== removeIds.length || removeIds.some(id => typeof id !== 'string' || !guidanceIdPattern.test(id))) throw new Error('removeIds只能包含已接受的应用指导ID。');
  const evidence = documentEvidence(inputs);
  const seen = new Set();
  const correcting = new Set();
  const rows = guidance.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !itemKeys.has(key))) throw new Error('应用指导含未知字段。');
    const subject = text(raw.subject), category = text(raw.category), statement = text(raw.statement);
    if (!subject || !categories.has(category) || !statement) throw new Error('应用指导需要subject、合法category和statement。');
    if (raw.id !== undefined && (typeof raw.id !== 'string' || !guidanceIdPattern.test(raw.id))) throw new Error(`应用指导修正ID无效：${subject}`);
    if (statement.length > 12000) throw new Error(`应用指导过长：${subject}`);
    if (!Array.isArray(raw.citations) || !raw.citations.length || raw.citations.length > 20) throw new Error(`应用指导需要逐字来源引用：${subject}`);
    const citations = raw.citations.map(citation => validateCitation(citation, evidence, subject));
    const unsupported = unsupportedQuantities(statement, citations);
    if (unsupported.length) throw new Error(`应用指导数值未由本条引用支持：${subject}：${unsupported.join('、')}。请补充当前资料中的对应逐字引用，或把该数值保留为第三步设计选择。`);
    if (nonApplicationSource({ sourceType: '', document: '', section: '' }, statement)) throw new Error(`应用指导不能把几何、脚本或网表写成资料事实：${subject}`);
    const id = raw.id || guidanceId({ subject, category, statement, citations });
    if (seen.has(id)) throw new Error(`应用指导重复：${subject}`);
    seen.add(id);
    if (raw.id) correcting.add(raw.id);
    return {
      id,
      subject,
      category,
      statement,
      citations,
      simulated: citations.some(citation => citation.simulated),
      sourceType: 'model-specification-guidance',
    };
  });
  if ([...correcting].some(id => removeIds.includes(id))) throw new Error('同一批次不能同时修正并撤回同一个应用指导ID。');
  return rows;
}

/**
 * Return only the currently confirmed stage-2 result. Inputs and stale plans
 * are deliberately excluded so later stages cannot resurrect old guidance.
 */
export function projectGuidance(project) {
  const stage = Array.isArray(project?.stages) ? project.stages.find(candidate => Number(candidate?.id) === 2) : undefined;
  if (!stage || stage.status !== 'done' || stage.confirmed !== true || !Array.isArray(stage.result?.guidance)) return [];
  return structuredClone(stage.result.guidance);
}

