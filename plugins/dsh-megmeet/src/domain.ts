import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { continuousPower } from './power.js';

export const FIELDS = {
  input_voltage_v: { label: '输入电压', unit: 'V', kind: 'number', aliases: ['输入电压', 'input voltage'] },
  output_voltage_v: { label: '输出电压', unit: 'V', kind: 'number', aliases: ['输出电压', 'output voltage'] },
  output_power_w: { label: '输出功率', unit: 'W', kind: 'number', aliases: ['输出功率', '额定功率', 'output power', 'rated power'] },
  output_channels: { label: '输出路数', unit: '路', kind: 'number', aliases: ['输出路数', 'output channels', 'number of outputs'] },
  output_current_a: { label: '输出电流', unit: 'A', kind: 'number', aliases: ['输出电流', 'output current'] },
  input_frequency_hz: { label: '输入频率', unit: 'Hz', kind: 'number', aliases: ['输入频率', 'input frequency'] },
  width_mm: { label: '本体宽度', unit: 'mm', kind: 'number', aliases: ['本体宽度', '电源宽度', 'width'] },
  mounting: { label: '安装方式', unit: '', kind: 'text', aliases: ['安装方式', 'mounting'] },
  dc_ok: { label: 'DC OK继电器', unit: '', kind: 'text', aliases: ['DC OK继电器', 'DC-OK relay'] },
  peak_power_w: { label: '峰值功率', unit: 'W', kind: 'number', aliases: ['峰值功率', 'peak power'] },
  peak_duration_s: { label: '峰值持续时间', unit: 's', kind: 'number', aliases: ['峰值持续时间', 'peak duration'] },
  continuous_load_w: { label: '持续负载', unit: 'W', kind: 'number', aliases: ['持续负载', 'continuous load'] },
  power_margin_pct: { label: '设计裕量', unit: '%', kind: 'number', aliases: ['设计裕量', 'power margin'] },
  orientation: { label: '安装姿态', unit: '', kind: 'text', aliases: ['安装姿态', 'orientation'] },
  altitude_m: { label: '海拔', unit: 'm', kind: 'number', aliases: ['海拔', 'altitude'] },
  top_clearance_mm: { label: '上方间距', unit: 'mm', kind: 'number', aliases: ['上方间距', 'top clearance'] },
  bottom_clearance_mm: { label: '下方间距', unit: 'mm', kind: 'number', aliases: ['下方间距', 'bottom clearance'] },
  side_clearance_mm: { label: '侧面间距', unit: 'mm', kind: 'number', aliases: ['侧面间距', 'side clearance'] },
  efficiency_pct: { label: '效率', unit: '%', kind: 'number', aliases: ['转换效率', '效率', 'efficiency'] },
  temperature_c: { label: '工作温度', unit: '°C', kind: 'number', aliases: ['工作温度', '环境温度', 'operating temperature', 'ambient temperature'] },
  protocols: { label: '通信协议', unit: '', kind: 'list', aliases: ['通信协议', '通讯协议', '通信接口', '通讯接口', 'protocols', 'protocol', 'interfaces'] },
  certifications: { label: '认证', unit: '', kind: 'list', aliases: ['认证', 'certifications', 'certification'] },
  cooling: { label: '散热方式', unit: '', kind: 'text', aliases: ['散热方式', '冷却方式', 'cooling'] },
  input_type: { label: '输入类型', unit: '', kind: 'text', aliases: ['输入类型', 'input type'] },
  output_type: { label: '输出类型', unit: '', kind: 'text', aliases: ['输出类型', 'output type'] },
} as const;

export type Field = keyof typeof FIELDS;
export type Operator = 'gte' | 'lte' | 'eq' | 'range' | 'includes';
export type ConstraintInput = {
  field: Field;
  operator: Operator;
  value?: number;
  min?: number;
  max?: number;
  textValue?: string;
  hard?: boolean;
  sourceQuote: string;
};
export type Constraint = ConstraintInput & { id: string; hard: boolean; origin: 'rule' | 'provided' | 'derived' };
export type PowerCalculation = { loadW: number; marginPct: number; requiredContinuousW: number; sourceQuotes: string[] };
export type RequirementResult = {
  constraints: Constraint[];
  unresolved: string[];
  warnings: string[];
  calculations?: PowerCalculation[];
};
type Span = { min: number; max: number };
export type Parameter = number | Span | string | string[];
export type SourceLink = { kind: 'official' | 'snapshot'; href: string; markdown: string };
export type Source = {
  id: string; title: string; version: string; location: string;
  /** Administrator-provided public document or landing page, never inferred by the model. */
  url?: string;
  /** Local original; relative paths are resolved against the catalog JSON directory. */
  file?: string;
  line?: number;
  sha256?: string;
  page?: number;
  /** Generated from validated addresses; preserve these links in the final chat answer. */
  links?: SourceLink[];
};
export type Evidence = { sourceId: string; quote: string; page?: number };
export type PowerProfile = Evidence & {
  points: { temperatureC: number; powerW: number }[];
  inputMinV: number; inputMaxV: number;
  orientation: string; maxAltitudeM: number;
  clearancesMm: { top: number; bottom: number; side: number };
  basis: 'rated_continuous';
  conditionsEvidence?: Evidence[];
};
export type Product = {
  id: string;
  name: string;
  family: string;
  description: string;
  parameters: Partial<Record<Field, Parameter>>;
  evidence: Partial<Record<Field, Evidence>>;
  manufacturer?: string;
  continuousPowerProfile?: PowerProfile;
  widthToleranceMm?: number;
};
export type Catalog = {
  schemaVersion: 1 | 2;
  dataset: string;
  version: string;
  demo: boolean;
  sources: Source[];
  products: Product[];
  /** Hash of the exact administrator-provided JSON bytes, generated at load. */
  revision?: string;
};
export type Check = {
  constraintId: string;
  field: Field;
  label: string;
  hard: boolean;
  expected: string;
  actual: string;
  status: 'pass' | 'fail' | 'unknown';
  reason: string;
  source: Source | null;
  quote: string;
  supportingEvidence?: Evidence[];
  page?: number;
};
export type Candidate = {
  productId: string;
  productName: string;
  family: string;
  status: 'matches_listed_constraints' | 'needs_confirmation' | 'incompatible';
  score: number;
  checks: Check[];
  power?: { ratedW?: number; verifiedContinuousW?: number; peakW?: number; peakDurationS?: number; temperatureC?: number; basis: string };
};
export type SearchResult = {
  dataset: string;
  catalogVersion: string;
  demo: boolean;
  humanReviewRequired: true;
  requirements: RequirementResult;
  candidates: Candidate[];
  totalEvaluated: number;
  totalCandidates: number;
  excludedIncompatible: number;
  catalogRevision?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function span(value: unknown): value is Span {
  return record(value) && finite(value.min) && finite(value.max) && value.min <= value.max;
}
function cleanString(value: unknown, label: string, max = 4000): asserts value is string {
  assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label} 必须为非空字符串（最多 ${max} 字符）。`);
}
function isField(field: string): field is Field {
  return Object.hasOwn(FIELDS, field);
}
function normalizeText(text: string): string {
  const compact = text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const aliases: Record<string, string> = {
    'rs-485': 'rs485', 'rs 485': 'rs485', 'can fd': 'can-fd',
    '风冷': 'fan', '风扇': 'fan', '风扇散热': 'fan', '自然冷却': 'natural', '自然散热': 'natural',
    '液冷': 'liquid', '交流': 'ac', '交流输入': 'ac', '直流': 'dc', '直流输入': 'dc',
    '导轨': 'din', 'din rail': 'din', '垂直': 'vertical', '竖直': 'vertical', '有': 'yes', '无': 'no',
    '垂直且输入端子朝下': 'vertical-input-terminals-bottom',
  };
  return aliases[compact] ?? compact;
}

/** Validate admin-provided catalog data before any product is offered to an agent. */
export function validateCatalog(data: unknown): Catalog {
  assert(record(data), '产品库必须为 JSON 对象。');
  assert(data.schemaVersion === 1 || data.schemaVersion === 2, '产品库 schemaVersion 必须为 1 或 2。');
  cleanString(data.dataset, 'dataset', 200);
  cleanString(data.version, 'version', 100);
  assert(typeof data.demo === 'boolean', '产品库必须显式设置 demo。');
  assert(Array.isArray(data.sources) && data.sources.length <= 20000, 'sources 必须为数组（最多 20000 项）。');
  const sourceIds = new Set<string>();
  for (const source of data.sources) {
    assert(record(source), 'source 必须为对象。');
    for (const key of ['id', 'title', 'version', 'location']) cleanString(source[key], `source.${key}`);
    assert(!sourceIds.has(String(source.id)), `重复来源 ID：${source.id}`);
    sourceIds.add(String(source.id));
    if (source.url !== undefined) {
      cleanString(source.url, 'source.url');
      const url = new URL(source.url);
      assert(/^https?:$/.test(url.protocol) && !url.username && !url.password && !/[\u0000-\u0020\u007f]/.test(source.url), 'source.url 必须是无凭据的 HTTP/HTTPS 地址。');
    }
    if (source.file !== undefined) {
      cleanString(source.file, 'source.file');
      assert(!/[\u0000-\u001f\u007f?#]/.test(source.file) && !/^[\\/]{2}/.test(source.file) && (!/^[a-z][a-z\d+.-]*:/i.test(source.file) || /^[a-z]:[\\/]/i.test(source.file)), 'source.file 必须是本地文件路径，不能使用协议、UNC、查询或片段。');
    }
    if (source.line !== undefined) assert(source.file !== undefined && Number.isSafeInteger(source.line) && Number(source.line) > 0, 'source.line 必须对应本地文件的正整数行号。');
    if (source.sha256 !== undefined) assert(typeof source.sha256 === 'string' && /^[a-f\d]{64}$/i.test(source.sha256) && source.file !== undefined, 'source.sha256 必须对应本地原件的SHA-256。');
    if (source.page !== undefined) assert(Number.isSafeInteger(source.page) && Number(source.page) > 0, 'source.page 必须为正整数。');
  }
  assert(Array.isArray(data.products) && data.products.length > 0 && data.products.length <= 10000, 'products 必须包含 1–10000 个产品。');
  const productIds = new Set<string>();
  for (const product of data.products) {
    assert(record(product), 'product 必须为对象。');
    for (const key of ['id', 'name', 'family', 'description']) cleanString(product[key], `product.${key}`);
    assert(!productIds.has(String(product.id)), `重复产品 ID：${product.id}`);
    productIds.add(String(product.id));
    assert(record(product.parameters) && record(product.evidence), `产品 ${product.id} 缺少 parameters/evidence。`);
    if(product.widthToleranceMm!==undefined) assert(finite(product.widthToleranceMm)&&product.widthToleranceMm>=0,'本体宽度公差必须为非负有限数字。');
    for (const [key, value] of Object.entries(product.parameters)) {
      assert(isField(key), `不支持的产品参数：${key}`);
      const kind = FIELDS[key].kind;
      if (kind === 'number') {
        assert(finite(value) || span(value), `参数 ${key} 必须是有限数字或有效 min/max 区间。`);
        const values = finite(value) ? [value] : [(value as Span).min, (value as Span).max];
        if (key !== 'temperature_c') assert(values.every(v => v >= 0), `${key} 不能为负数。`);
        if (key === 'efficiency_pct') assert(values.every(v => v <= 100), '效率应在 0–100% 内。');
        if (key === 'output_channels') assert(finite(value) && Number.isSafeInteger(value) && value >= 1 && value <= 100, '输出路数必须是1–100的整数。');
      } else if (kind === 'list') {
        assert(Array.isArray(value) && value.length <= 100, `${key} 必须为字符串数组。`);
        value.forEach(item => cleanString(item, key, 100));
      } else cleanString(value, key, 200);
    }
    for (const [key, evidence] of Object.entries(product.evidence)) {
      assert(isField(key) && Object.hasOwn(product.parameters, key), `来源对应的参数不存在：${key}`);
      assert(record(evidence), `参数 ${key} 的 evidence 必须为对象。`);
      cleanString(evidence.sourceId, 'evidence.sourceId');
      cleanString(evidence.quote, 'evidence.quote');
      assert(sourceIds.has(evidence.sourceId), `参数 ${key} 引用不存在的来源：${evidence.sourceId}`);
      if (evidence.page !== undefined) assert(Number.isSafeInteger(evidence.page) && Number(evidence.page) > 0, '依据页码必须为正整数。');
    }
    if (product.continuousPowerProfile !== undefined) {
      const profile = product.continuousPowerProfile;
      assert(record(profile) && profile.basis === 'rated_continuous', '连续功率曲线必须标明rated_continuous。');
      cleanString(profile.sourceId, '连续功率来源');
      cleanString(profile.quote, '连续功率原文');
      assert(sourceIds.has(profile.sourceId), '连续功率曲线引用不存在的来源。');
      assert(Array.isArray(profile.points) && profile.points.length >= 2 && profile.points.length <= 50, '连续功率曲线需要2–50个点。');
      let previous = -Infinity;
      for (const point of profile.points) {
        assert(record(point) && finite(point.temperatureC) && finite(point.powerW) && point.powerW >= 0 && point.temperatureC > previous, '连续功率曲线点必须有效且温度严格递增。');
        previous = point.temperatureC;
      }
      assert(finite(profile.inputMinV) && finite(profile.inputMaxV) && profile.inputMinV > 0 && profile.inputMinV <= profile.inputMaxV, '曲线交流输入工况无效。');
      cleanString(profile.orientation, '曲线安装姿态', 100);
      assert(finite(profile.maxAltitudeM) && profile.maxAltitudeM >= 0, '曲线海拔条件无效。');
      assert(record(profile.clearancesMm) && ['top', 'bottom', 'side'].every(key => finite((profile.clearancesMm as Record<string, unknown>)[key]) && Number((profile.clearancesMm as Record<string, unknown>)[key]) >= 0), '曲线安装间距无效。');
      if (profile.page !== undefined) assert(Number.isSafeInteger(profile.page) && Number(profile.page) > 0, '曲线页码无效。');
    }
  }
  return data as Catalog;
}

export async function loadCatalog(path: string, signal?: AbortSignal): Promise<Catalog> {
  const target: string | URL = path ? path : new URL('../examples/catalog.demo.json', import.meta.url);
  if (path) assert(isAbsolute(path), 'catalogPath 必须是管理员配置的绝对路径。');
  const info = await stat(target);
  assert(info.isFile() && info.size <= 5 * 1024 * 1024, '产品库必须是小于 5MB 的 JSON 文件。');
  const text = await readFile(target, { encoding: 'utf8', signal });
  assert(Buffer.byteLength(text, 'utf8') <= 5 * 1024 * 1024, '产品库超过 5MB。');
  const catalog = validateCatalog(JSON.parse(text));
  catalog.revision = createHash('sha256').update(text).digest('hex');
  const base = dirname(typeof target === 'string' ? target : fileURLToPath(target));
  catalog.sources = catalog.sources.map(source => {
    const file = source.file ? resolve(base, source.file) : undefined;
    const resolved = { ...source, ...(file ? { file } : {}) };
    return { ...resolved, links: sourceLinks(resolved) };
  });
  for (const source of catalog.sources) {
    if (source.sha256 && source.file) {
      const digest = createHash('sha256').update(await readFile(source.file, { signal })).digest('hex');
      assert(digest.toLowerCase() === source.sha256.toLowerCase(), `SOURCE_HASH_MISMATCH: ${source.id} 原件哈希不一致。`);
    }
  }
  return catalog;
}

const negative = /无需|不需要|不支持|不接受|不包含|不含|禁止|排除|(?:\bno\b|\bnot\b|\bwithout\b)/i;
const numericPattern = /([+-]?\d+(?:\.\d+)?)\s*(kW|MW|W|kV|mV|VAC|VDC|V|℃|°C|%|％|路|Hz|mm|A|s|m)?\s*(?:([~～–—]|至|到|\bto\b|-)\s*([+-]?\d+(?:\.\d+)?)\s*(kW|MW|W|kV|mV|VAC|VDC|V|℃|°C|%|％|路|Hz|mm|A|s|m)?)?/i;
function quantity(value: string, unit: string, field: Field): number {
  const n = Number(value);
  const u = unit.trim();
  const kind = FIELDS[field].unit;
  let factor = 1;
  if (kind === 'W') {
    assert(/^(?:W|kW|MW)$/i.test(u), '功率必须注明 W、kW 或 MW。');
    assert(!/^mw$/i.test(u) || u === 'MW', '暂不支持 mW 或含糊的 mw；请换算为 W。');
    factor = /^k/i.test(u) ? 1000 : u === 'MW' ? 1000000 : 1;
  } else if (kind === 'V') {
    assert(/^(?:V|kV|mV|VAC|VDC)$/i.test(u), '电压必须注明 V、kV 或 mV。');
    assert(!/^mv$/i.test(u) || /^m[vV]$/.test(u), '暂不支持 MV；请换算为 V。');
    factor = /^k/i.test(u) ? 1000 : /^m/.test(u) ? 0.001 : 1;
  } else if (kind === '%') assert(/^(?:%|％)$/.test(u), '效率必须注明 %。');
  else if (kind === '路') assert(u === '路' && Number.isSafeInteger(n) && n >= 1 && n <= 100, '输出路数必须注明路，且为1–100的整数。');
  else if (['A', 'Hz', 'mm', 's', 'm'].includes(kind)) assert(u.toLowerCase() === kind.toLowerCase(), `参数必须注明 ${kind}。`);
  else assert(/^(?:℃|°C)$/i.test(u), '温度必须注明 ℃ 或 °C。');
  const result = n * factor;
  assert(Number.isFinite(result), '参数值必须为有限数字。');
  return result;
}

function numericConstraint(field: Field, body: string, quote: string): ConstraintInput[] {
  assert(!negative.test(body), '否定或排除条件需要人工确认。');
  const match = numericPattern.exec(body);
  assert(match, '未识别到参数值。');
  const [, first, firstUnit = '', separator, second, secondUnit = ''] = match;
  const before = body.slice(0, match.index);
  const after = body.slice(match.index + match[0].length);
  assert(!/[\d]|且|并且|或者|或|负载|海拔|降额|\band\b|\bor\b/i.test(after), '存在复合条件或测试条件，需要补充结构化约束。');
  const firstValue = quantity(first, firstUnit || secondUnit, field);
  const hard = !/建议|优选|尽量|prefer|optional/i.test(body);
  const common = { field, hard, sourceQuote: quote };
  const acceptedModifiers = /不低于|不高于|不超过|大于等于|小于等于|至少|最多|以上|以下|必须|需要|要求|建议|优选|尽量|为|是|需|应|at least|at most|minimum|maximum|prefer(?:red)?|optional|min\b|max\b|AC|DC|交流|直流|[\s:：=≥≤><,，、|()（）]/gi;
  assert(!(before + after).replace(acceptedModifiers, ''), '数值前后存在额外限定或未解析内容，需要确认。');
  const voltageTypes = field === 'input_voltage_v' || field === 'output_voltage_v' ? [...new Set([...body.matchAll(/V(AC|DC)|\b(AC|DC)(?=\b|[+-]?\d)|交流|直流/gi)].map(m => (m[1] || m[2] || (m[0] === '交流' ? 'AC' : 'DC')).toUpperCase()))] : [];
  assert(voltageTypes.length <= 1, '同时包含 AC/DC，需要分别确认。');
  const inferred: ConstraintInput[] = voltageTypes.length ? [{ field: field === 'input_voltage_v' ? 'input_type' : 'output_type', operator: 'eq', textValue: voltageTypes[0], hard, sourceQuote: quote }] : [];
  if (separator && second !== undefined) {
    const secondValue = quantity(second, secondUnit || firstUnit, field);
    assert(firstValue <= secondValue, '区间下限不能大于上限。');
    return [{ ...common, operator: 'range', min: firstValue, max: secondValue }, ...inferred];
  }
  const lower = /≥|>=|不低于|至少|以上|大于等于|at least|minimum|min\b/i.test(before + after);
  const upper = /≤|<=|不高于|不超过|最多|以下|小于等于|at most|maximum|max\b/i.test(before + after);
  assert(!(lower && upper), '同时出现上下限词，需要确认。');
  const strictText = (before + after).replace(/>=|<=|大于等于|小于等于|不低于|不高于/g, '');
  assert(!/>|<|高于|低于|大于|小于/.test(strictText), '严格大于/小于条件暂需转换或确认，不能按含边界条件处理。');
  return [{ ...common, operator: lower ? 'gte' : upper ? 'lte' : 'eq', value: firstValue }, ...inferred];
}

function textConstraints(field: Field, body: string, quote: string): ConstraintInput[] {
  assert(!negative.test(body) && !/或|二选一|任选|\bor\b/i.test(body), '否定条件或任选条件需要确认。');
  const value = body.replace(/^[\s:：=,，、-]+/, '').replace(/^(?:必须|需要|要求|需|应)?\s*(?:支持|具备|通过|采用|为|是|包含|包括|support(?:s)?|requires?)\s*/i, '').replace(/[。.;；\s]+$/, '');
  const pieces = FIELDS[field].kind === 'list' ? value.split(/[,，、/&]|以及|及|和/) : [value];
  assert(pieces.length <= 20 && pieces.length > 0, '文本参数列表过长。');
  return pieces.map(piece => {
    const item = piece.trim();
    cleanString(item, '文本参数', 100);
    assert((field === 'orientation' && item === '垂直且输入端子朝下') || !/要求|需要|必须|建议|优选|尽量|且|\band\b/i.test(item), '存在无法完整解析的文本条件。');
    return { field, operator: FIELDS[field].kind === 'list' ? 'includes' : 'eq', textValue: item, hard: true, sourceQuote: quote };
  });
}

function validateConstraint(input: ConstraintInput, sourceText: string): void {
  assert(isField(input.field), `不支持的字段：${input.field}`);
  assert(['gte', 'lte', 'eq', 'range', 'includes'].includes(input.operator), '不支持的比较操作。');
  cleanString(input.sourceQuote, 'sourceQuote');
  assert(sourceText.includes(input.sourceQuote), '结构化约束 sourceQuote 必须逐字出现在需求原文中。');
  const kind = FIELDS[input.field].kind;
  if (kind === 'number') {
    assert(input.textValue === undefined, '数字约束不能含 textValue。');
    if (input.operator === 'range') {
      assert(input.value === undefined && finite(input.min) && finite(input.max) && input.min <= input.max, 'range 需要有效的 min/max，且不能含 value。');
    } else {
      assert(['gte', 'lte', 'eq'].includes(input.operator) && finite(input.value), '数字约束需要 value 和 gte/lte/eq 操作。');
      assert(input.min === undefined && input.max === undefined, '单值约束不能含 min/max。');
    }
    const values = input.operator === 'range' ? [input.min!, input.max!] : [input.value!];
    if (input.field !== 'temperature_c') assert(values.every(v => v >= 0), `${input.field} 不能为负数。`);
    if (input.field === 'efficiency_pct') assert(values.every(v => v <= 100), '效率必须在 0–100% 内。');
    if (input.field === 'output_channels') assert(values.every(v => Number.isSafeInteger(v) && v >= 1 && v <= 100), '输出路数必须是1–100的整数。');
  } else {
    assert(input.operator === (kind === 'list' ? 'includes' : 'eq'), '文本约束的比较操作不正确。');
    cleanString(input.textValue, 'textValue', 100);
    assert(input.value === undefined && input.min === undefined && input.max === undefined, '文本约束不能包含数值参数。');
  }
}

/** Rules provide a conservative first extraction; model additions must quote the input. */
export function parseRequirements(text: string, additions: ConstraintInput[] = [], maxChars = 60000): RequirementResult {
  cleanString(text, '需求原文', maxChars);
  assert(additions.length <= 100, '最多允许 100 项补充约束。');
  additions.forEach(input => validateConstraint(input, text));
  const aliasToField = new Map<string, Field>();
  for (const [field, definition] of Object.entries(FIELDS)) {
    for (const alias of definition.aliases) aliasToField.set(alias.toLowerCase(), field as Field);
  }
  const aliases = [...aliasToField.keys()].sort((a, b) => b.length - a.length);
  const expression = new RegExp(aliases.join('|'), 'gi');
  const inputs: Array<ConstraintInput & { origin: 'rule' | 'provided' | 'derived' }> = [];
  const unresolved: string[] = [];
  const warnings: string[] = [];
  for (const raw of text.split(/[\r\n;；。]+/)) {
    const line = raw.trim().replace(/^(?:[-*•]\s*|\d+[.)、]\s*)/, '');
    if (!line) continue;
    // Explicit topology is independent of per-channel voltage/current requirements.
    // Keep the latter unresolved; a known single-output product must still fail a dual-output request.
    const topology = /([单双两三四])路(?:同时)?(?:直流)?输出/.exec(line);
    if (topology && !negative.test(line) && !/或|任选|可选|可以|可为/.test(line)) {
      const counts: Record<string, number> = { 单:1, 双:2, 两:2, 三:3, 四:4 };
      const input: ConstraintInput = { field:'output_channels', operator:'eq', value:counts[topology[1]], hard:true, sourceQuote:topology[0] };
      validateConstraint(input,text);
      inputs.push({ ...input, origin:'rule' });
    }
    const hits = [...line.matchAll(expression)];
    if (hits.length === 0) {
      if (!additions.some(c => c.sourceQuote.includes(line))) unresolved.push(line);
      continue;
    }
    const prefix = line.slice(0, hits[0].index).replace(/[\s,，、:：]+/g, '');
    if (prefix && !/^(?:要求|需求|客户要求)$/.test(prefix)) unresolved.push(prefix);
    for (let i = 0; i < hits.length; i++) {
      const hit = hits[i];
      const start = hit.index!;
      const end = hits[i + 1]?.index ?? line.length;
      const quote = line.slice(start, end).replace(/[,，、\s]+$/, '');
      const field = aliasToField.get(hit[0].toLowerCase())!;
      const body = quote.slice(hit[0].length);
      try {
        const extracted = FIELDS[field].kind === 'number' ? numericConstraint(field, body, quote) : textConstraints(field, body, quote);
        for (const input of extracted) {
          validateConstraint(input, text);
          inputs.push({ ...input, origin: 'rule' });
        }
      } catch (error) {
        if (!additions.some(c => c.sourceQuote.includes(quote))) {
          unresolved.push(quote);
          warnings.push(`${quote}：${error instanceof Error ? error.message : '需人工确认。'}`);
        }
      }
    }
  }
  inputs.push(...additions.map(c => ({ ...c, origin: 'provided' as const })));
  const loads = inputs.filter(c => c.field === 'continuous_load_w');
  const margins = inputs.filter(c => c.field === 'power_margin_pct');
  const calculations: PowerCalculation[] = [];
  if (loads.length === 1 && margins.length === 1 && loads[0].operator === 'eq' && margins[0].operator === 'eq') {
    const load = loads[0], margin = margins[0];
    const required = Math.round(load.value! * (1 + margin.value! / 100) * 1e9) / 1e9;
    calculations.push({ loadW: load.value!, marginPct: margin.value!, requiredContinuousW: required, sourceQuotes: [load.sourceQuote, margin.sourceQuote] });
    inputs.push({ field: 'output_power_w', operator: 'gte', value: required, hard: true, origin: 'derived', sourceQuote: load.sourceQuote });
    for (let i = inputs.length - 1; i >= 0; i--) if (['continuous_load_w', 'power_margin_pct'].includes(inputs[i].field)) inputs.splice(i, 1);
  } else if (loads.length || margins.length) {
    unresolved.push('持续负载与设计裕量必须各有一个明确数值，才能计算连续功率需求。');
  }
  const seen = new Set<string>();
  const constraints: Constraint[] = [];
  for (const input of inputs) {
    const key = JSON.stringify([input.field, input.operator, input.value, input.min, input.max, input.textValue && normalizeText(input.textValue), input.hard ?? true]);
    if (seen.has(key)) continue;
    seen.add(key);
    constraints.push({ ...input, id: `R${constraints.length + 1}`, hard: input.hard ?? true });
  }
  assert(constraints.length <= 100, '提取结果超过 100 条约束；请拆分需求。');
  if (constraints.length === 0) warnings.push('没有可校验约束；请补充明确参数，或提供带原文引用的结构化约束。');
  return { constraints, unresolved: [...new Set(unresolved)], warnings: [...new Set(warnings)], ...(calculations.length ? { calculations } : {}) };
}

function actualText(value: Parameter | undefined, field: Field): string {
  const unit = FIELDS[field].unit;
  if (value === undefined) return '资料缺失';
  if (finite(value)) return `${value}${unit}`;
  if (span(value)) return `${value.min}–${value.max}${unit}`;
  return Array.isArray(value) ? value.join('、') : String(value);
}
function expectedText(c: Constraint): string {
  const unit = FIELDS[c.field].unit;
  if (c.operator === 'range') return `覆盖 ${c.min}–${c.max}${unit}`;
  if (c.operator === 'includes') return `包含 ${c.textValue}`;
  const symbol = c.operator === 'gte' ? '≥' : c.operator === 'lte' ? '≤' : '=';
  return `${symbol} ${c.value === undefined ? c.textValue : `${c.value}${unit}`}`;
}
const approximately = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-9;
const ge = (a: number, b: number) => a > b || approximately(a, b);
const le = (a: number, b: number) => a < b || approximately(a, b);

export function validateCandidate(catalog: Catalog, requirements: RequirementResult, productId: string): Candidate {
  const product = catalog.products.find(p => p.id === productId);
  assert(product, `产品 ID 不存在：${productId}`);
  const power = continuousPower(catalog, product, requirements);
  const checks: Check[] = requirements.constraints.map(c => {
    let actual = product.parameters[c.field];
    let evidence = product.evidence[c.field];
    const contextFields = ['orientation', 'altitude_m', 'top_clearance_mm', 'bottom_clearance_mm', 'side_clearance_mm'];
    const profile = product.continuousPowerProfile;
    if (profile && contextFields.includes(c.field)) {
      const values = { orientation: profile.orientation, altitude_m: profile.maxAltitudeM, top_clearance_mm: profile.clearancesMm.top, bottom_clearance_mm: profile.clearancesMm.bottom, side_clearance_mm: profile.clearancesMm.side };
      actual = values[c.field as keyof typeof values];
      evidence = product.evidence[c.field] ?? { sourceId: profile.sourceId, page: profile.page, quote: profile.quote };
    }
    if (c.field === 'output_power_w' && (catalog.schemaVersion === 2 || requirements.calculations?.length)) {
      if (power.watts !== undefined) { actual = power.watts; evidence = power.evidence; }
      else {
        // A documented rated capacity below demand is an exclusion under the declared rated-continuous policy.
        const rated = product.parameters.output_power_w;
        if (finite(rated) && product.evidence.output_power_w && c.operator === 'gte' && rated < c.value!) {
          const src = catalog.sources.find(s => s.id === product.evidence.output_power_w!.sourceId) ?? null;
          return { constraintId:c.id, field:c.field, label:'额定连续功率', hard:c.hard, expected:expectedText(c), actual:`额定${rated}W`, status:src ? 'fail' : 'unknown', source:src, quote:product.evidence.output_power_w.quote, reason:src ? '额定连续能力不足。限时峰值不代替额定连续能力；额外PowerBoost不在本轮额定筛查范围内。' : '额定功率缺少来源。' };
        }
        return { constraintId:c.id, field:c.field, label:'额定连续功率', hard:c.hard, expected:expectedText(c), actual:'工况资料缺失', status:'unknown', source:power.evidence ? catalog.sources.find(s => s.id === power.evidence!.sourceId) ?? null : null, quote:power.evidence?.quote ?? '', reason:power.reason };
      }
    }
    const source = evidence ? catalog.sources.find(s => s.id === evidence.sourceId) ?? null : null;
    const base = { constraintId: c.id, field: c.field, label: FIELDS[c.field].label, hard: c.hard, expected: expectedText(c), actual: actualText(actual, c.field), source, quote: evidence?.quote ?? '', page:evidence?.page, ...(c.field==='output_power_w'&&profile?.conditionsEvidence?{supportingEvidence:profile.conditionsEvidence}:{}) };
    if (actual === undefined || !source) return { ...base, status: 'unknown', reason: actual === undefined ? '产品库没有该参数。' : '参数缺少可追溯来源，不能判为满足。' };
    if (profile && contextFields.includes(c.field) && c.operator === 'eq') {
      const supplied = normalizeText(c.textValue ?? '');
      const pass = c.field === 'orientation' ? normalizeText(String(actual)) === supplied || (actual === 'vertical' && supplied === 'vertical-input-terminals-bottom') : c.field === 'altitude_m' ? le(c.value!, Number(actual)) : ge(c.value!, Number(actual));
      return { ...base, status:pass ? 'pass' : 'fail', reason:pass ? '安装前提符合厂家曲线条件。' : '安装前提不符合厂家曲线条件。' };
    }
    if (c.field === 'width_mm' && finite(actual) && c.operator === 'lte' && product.widthToleranceMm !== undefined) {
      const maximum = actual + product.widthToleranceMm;
      return { ...base, actual:`${actual}mm ±${product.widthToleranceMm}mm；最大${maximum}mm`, status:le(maximum,c.value!) ? 'pass':'fail', reason:'按本体标称宽度加厂家机械公差的上界校验。' };
    }
    let pass: boolean;
    if (FIELDS[c.field].kind === 'number') {
      if (c.operator === 'range') {
        if (!span(actual)) return { ...base, status: 'unknown', reason: '单个标称值不能证明工作区间覆盖。' };
        pass = le(actual.min, c.min!) && ge(actual.max, c.max!);
      } else if (span(actual)) {
        if (c.operator === 'eq') pass = le(actual.min, c.value!) && ge(actual.max, c.value!);
        else return { ...base, status: 'unknown', reason: '区间型产品参数与单侧阈值的含义需要确认；请使用完整范围。' };
      } else {
        assert(finite(actual), '无效数值参数。');
        pass = c.operator === 'gte' ? ge(actual, c.value!) : c.operator === 'lte' ? le(actual, c.value!) : approximately(actual, c.value!);
      }
    } else if (Array.isArray(actual)) pass = actual.some(v => normalizeText(v) === normalizeText(c.textValue!));
    else pass = normalizeText(String(actual)) === normalizeText(c.textValue!);
    return { ...base, status: pass ? 'pass' : 'fail', reason: c.field === 'output_power_w' && power.watts !== undefined ? power.reason : pass ? '按产品库资料，通过此项已列条件。' : '产品库参数不满足此项已列条件。' };
  });
  const hardFail = checks.some(c => c.hard && c.status === 'fail');
  const hasUnknown = checks.some(c => c.status === 'unknown') || requirements.unresolved.length > 0 || checks.length === 0;
  const weight = (c: Check) => c.hard ? 2 : 1;
  const totalWeight = checks.reduce((sum, c) => sum + weight(c), 0);
  const score = totalWeight ? Math.round(100 * checks.filter(c => c.status === 'pass').reduce((sum, c) => sum + weight(c), 0) / totalWeight) : 0;
  return { productId: product.id, productName: product.name, family: product.family, status: hardFail ? 'incompatible' : hasUnknown ? 'needs_confirmation' : 'matches_listed_constraints', score, checks, ...(catalog.schemaVersion === 2 ? { power: { ratedW: finite(product.parameters.output_power_w) ? product.parameters.output_power_w : undefined, verifiedContinuousW:power.watts, temperatureC:power.temperatureC, peakW:finite(product.parameters.peak_power_w) ? product.parameters.peak_power_w : undefined, peakDurationS:finite(product.parameters.peak_duration_s) ? product.parameters.peak_duration_s : undefined, basis:'厂家额定连续曲线；峰值与PowerBoost另列。' } } : {}) };
}

export function searchProducts(catalog: Catalog, requirements: RequirementResult, options: { family?: string; limit?: number; includeIncompatible?: boolean } = {}): SearchResult {
  const limit = options.limit ?? 10;
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 50, 'limit 必须为 1–50 的整数。');
  const products = options.family ? catalog.products.filter(p => p.family === options.family) : catalog.products;
  const all = products.map(p => validateCandidate(catalog, requirements, p.id));
  const filtered = options.includeIncompatible ? all : all.filter(p => p.status !== 'incompatible');
  const rank = { matches_listed_constraints: 0, needs_confirmation: 1, incompatible: 2 };
  filtered.sort((a, b) => rank[a.status] - rank[b.status] || b.score - a.score || a.productId.localeCompare(b.productId));
  return { dataset: catalog.dataset, catalogVersion: catalog.version, catalogRevision:catalog.revision, demo: catalog.demo, humanReviewRequired: true, requirements, candidates: filtered.slice(0, limit), totalEvaluated: all.length, totalCandidates: filtered.length, excludedIncompatible: all.filter(p => p.status === 'incompatible').length };
}

/** Escape external text for Markdown tables and suppress embedded HTML/links. */
function md(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, ' ').replace(/[\\`*_{}\[\]()#!|]/g, '\\$&');
}
/** DSH rc.2 accepts ordinary HTTPS links and absolute file paths with optional #L<n>. */
export function sourceLinks(source: Source): SourceLink[] {
  const label = md(`${source.id} · ${source.version}`);
  const links: SourceLink[] = [];
  const encodeDestination = (value: string) => value.replace(/[()\[\]|<>]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  if (source.url) {
    const url = new URL(source.url);
    assert(/^https?:$/.test(url.protocol) && !url.username && !url.password && !/[\u0000-\u0020\u007f]/.test(source.url), '无效资料链接。');
    const href = encodeDestination(url.href);
    links.push({ kind: 'official', href, markdown: `[${source.file ? '官网资料入口' : label}](${href})` });
  }
  if (source.file && (isAbsolute(source.file) || win32.isAbsolute(source.file))) {
    assert(!/[\u0000-\u001f\u007f?#]/.test(source.file) && !/^[\\/]{2}/.test(source.file), '无效本地资料路径。');
    const path = source.file.replace(/\\/g, '/');
    const href = path.split('/').map((part, i) => i === 0 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)).join('/') + (source.line ? `#L${source.line}` : '');
    links.push({ kind: 'snapshot', href, markdown: `[${label}](${href})` });
  }
  return links;
}
function sourceMarkdown(source: Source): string {
  const links = sourceLinks(source);
  return links.length ? links.map(link => link.markdown).join(' · ') : `${md(source.id)}（${md(source.version)}）`;
}
const STATUS = { matches_listed_constraints: '通过已列条件，仍需工程确认', needs_confirmation: '待确认', incompatible: '存在硬性条件不匹配' };

export function generateReport(result: SearchResult, title = '客户需求与产品候选方案'): { markdown: string; demo: boolean; humanReviewRequired: true } {
  cleanString(title, '报告标题', 200);
  const { requirements } = result;
  const lines = [
    `# ${md(title)}`, '',
    result.demo ? '> **演示数据：以下型号、参数和来源均为虚构样例，不代表麦格米特真实产品。**' : '> 本报告仅校验所列条件，须由工程师复核资料版本、工况和适用性后使用。', '',
    `产品库：${md(result.dataset)}；版本：${md(result.catalogVersion)}。`, '',
    '## 已提取需求', '', '| 条件 | 类型 | 要求 | 原文依据 |', '| --- | --- | --- | --- |',
  ];
  for (const c of requirements.constraints) lines.push(`| ${c.id} ${FIELDS[c.field].label} | ${c.hard ? '硬性' : '偏好'} | ${md(expectedText(c))} | ${md(c.sourceQuote)} |`);
  if (requirements.constraints.length === 0) lines.push('| — | — | 没有可校验约束 | 请补充明确需求 |');
  lines.push('', '## 候选产品', '', `本次评估 ${result.totalEvaluated} 个产品；候选 ${result.totalCandidates} 个，显示 ${result.candidates.length} 个；排除硬性不匹配 ${result.excludedIncompatible} 个。`, '', '得分表示已列条件的加权通过比例，不表示置信度、性能优劣或项目可行性。', '');
  if (result.candidates.length === 0) lines.push('没有候选产品。请确认参数、产品类型和资料完整性；不能据此断言市场上不存在合适产品。', '');
  const sources = new Map<string, Source>();
  for (const c of result.candidates) {
    lines.push(`### ${md(c.productId)} · ${md(c.productName)}`, '', `${STATUS[c.status]}；已列条件得分 ${c.score}/100。`, '', '| 参数 | 要求 | 产品资料值 | 结果 | 依据/说明 |', '| --- | --- | --- | --- | --- |');
    for (const check of c.checks) {
      if (check.source) sources.set(check.source.id, check.source);
      const note = check.source ? `${sourceMarkdown(check.source)}：${md(check.quote)}；${md(check.reason)}` : md(check.reason);
      lines.push(`| ${check.label} | ${md(check.expected)} | ${md(check.actual)} | ${{ pass: '通过', fail: '不匹配', unknown: '待确认' }[check.status]} | ${note} |`);
    }
    lines.push('');
  }
  lines.push('## 待确认事项', '');
  for (const unresolved of requirements.unresolved) lines.push(`- 未完整解析：${md(unresolved)}`);
  for (const warning of requirements.warnings) lines.push(`- ${md(warning)}`);
  lines.push('- 复核客户原文与结构化条件是否一致，确认未遗漏安装、尺寸、认证范围等要求。', '- 确认效率测试工况、温度降额、输入类型及其他应用限制；这些限制不会由单个参数自动证明。', '- 由工程师确认产品适用性；价格、库存和交期未接入，不在本次结论范围内。', '', '## 资料来源', '');
  for (const source of sources.values()) lines.push(`- ${sourceMarkdown(source)}：${md(source.title)}；位置 ${md(source.location)}。`);
  if (sources.size === 0) lines.push('- 无可追溯产品来源。');
  return { markdown: lines.join('\n'), demo: result.demo, humanReviewRequired: true };
}
