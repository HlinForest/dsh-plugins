import { createHash } from 'node:crypto';
import { validateBoard, validateContext } from './validation.js';
import { sources } from './knowledge.js';

export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export function review(input, context = {}) {
  validateBoard(input); validateContext(context);
  const board = structuredClone(input), findings = [], components = new Map(board.components.map(c => [c.ref, c]));
  if (context.allListedFitted) for (const c of board.components) if (c.dnp === null || c.dnp === undefined) c.dnp = false;
  for (const override of context.componentOverrides ?? []) {
    if (!components.has(override.ref)) throw new Error(`componentOverrides 引用未知器件 ${override.ref}`);
    Object.assign(components.get(override.ref), override);
  }
  const pinNets = new Map(), componentNets = new Map();
  for (const net of board.nets) for (const node of net.nodes) {
    pinNets.set(JSON.stringify([node.ref, node.pin]), net.name);
    if (!componentNets.has(node.ref)) componentNets.set(node.ref, []);
    componentNets.get(node.ref).push({ pin: node.pin, net: net.name });
  }
  const netNames = new Set(board.nets.map(n => n.name));
  function add(rule, status, title, refs, details, basis, net, pin) {
    const coordinates = refs.flatMap(ref => components.get(ref)?.position ? [{ ref, ...components.get(ref).position }] : []);
    findings.push({ id: `${rule}-${digest([refs, net, pin, title]).slice(0, 12)}`, rule, status, title, refs,
      ...(net ? { net } : {}), ...(pin ? { pin } : {}), coordinates, details, basis });
  }
  function capCheck(item, decoupling = false) {
    const net = pinNets.get(JSON.stringify([item.ref, item.pin])), target = components.get(item.ref);
    const rule = decoupling ? 'DECOUPLING' : 'INPUT_CAP', basis = item.basis ?? (item.kind === 'analog' ? '需依据输入特性确认；参考 ST AN2834 的适用部分' : '需提供该接口的时序、边沿与容性负载约束');
    if (!target || !net || !netNames.has(item.groundNet) || net === item.groundNet) {
      add(rule, 'unknown', '目标引脚或参考地无法确认', [item.ref], `需要 ${item.ref}.${item.pin} 的信号/电源网络与独立参考地 ${item.groundNet}。`, basis, net, item.pin); return;
    }
    if (target.dnp === true) {
      add(rule, 'not_applicable', '目标器件标记不装', [item.ref], '当前装配状态下不检查该引脚外围。', basis, net, item.pin); return;
    }
    const candidates = board.components.filter(c => (c.kind === 'capacitor' || (!c.kind && /^C\d/.test(c.ref))) && (() => {
      const pins = componentNets.get(c.ref) ?? [];
      return pins.length === 2 && pins.some(p => p.net === net) && pins.some(p => p.net === item.groundNet);
    })());
    const fitted = candidates.filter(c => c.dnp === false), uncertain = candidates.filter(c => c.dnp === undefined || c.dnp === null);
    const observed = candidates.map(c => `${c.ref}=${c.value}${c.dnp === true ? '（DNP，不计作已装）' : c.dnp !== false ? '（装配状态未知）' : ''}`).join('、') || '未找到直接跨接的两端电容';
    const policy = decoupling ? 'required' : item.capacitorPolicy;
    const detail = `${item.ref}.${item.pin} → ${net}；参考地 ${item.groundNet}；${observed}。只检查直接网络连接，未验证容值、采样时序、寄生、布局回路和电压额定值。`;
    if (policy === 'evaluate') {
      add(rule, 'unknown', '输入电容需要结合信号条件评估', [item.ref, ...candidates.map(c => c.ref)], `${detail} ${item.kind === 'high_speed' ? '高速数字信号需先核验时序与容性负载，不能默认加电容。' : '补充带宽/边沿、源阻抗、采样时间或去抖要求后，再确定是否需要电容。'}`, basis, net, item.pin);
    } else if (policy === 'forbidden') {
      add(rule, fitted.length ? 'warning' : uncertain.length ? 'unknown' : 'checked', fitted.length ? '存在项目规则不允许的输入电容' : uncertain.length ? '电容装配状态待确认' : '未发现规则禁止的已装电容', [item.ref, ...candidates.map(c => c.ref)], detail, basis, net, item.pin);
    } else {
      const knownTarget = target.dnp === false;
      add(rule, !knownTarget ? 'unknown' : fitted.length ? 'checked' : uncertain.length ? 'unknown' : 'warning', !knownTarget ? '目标器件装配状态待确认' : fitted.length ? '发现直接跨接的已装电容' : uncertain.length ? '电容装配状态待确认' : decoupling ? '未发现项目要求的已装去耦电容' : '未发现项目要求的已装输入电容', [item.ref, ...candidates.map(c => c.ref)], detail, basis, net, item.pin);
    }
  }
  for (const item of context.signals ?? []) capCheck(item);
  for (const item of context.decoupling ?? []) capCheck(item, true);
  for (const item of context.proximity ?? []) {
    const a = components.get(item.ref), b = components.get(item.nearRef), refs = [item.ref, item.nearRef];
    if (a?.dnp === true || b?.dnp === true) {
      add('PROXIMITY', 'not_applicable', '邻近检查涉及不装器件', refs, '当前装配版本不计算该器件对。', item.basis); continue;
    }
    if (!a?.position || !b?.position) {
      add('PROXIMITY', 'unknown', '缺少位置数据', refs, '需要同一坐标系的封装参考点（mm）。', item.basis); continue;
    }
    const mm = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
    add('PROXIMITY', mm > item.maxMm ? 'warning' : 'checked', mm > item.maxMm ? '封装参考点距离超过项目限值' : '封装参考点距离在项目限值内', refs,
      `平面参考点距离 ${mm.toFixed(3)} mm，项目限值 ${item.maxMm} mm。此结果不代表焊盘距离、回流、寄生电感、走线长度或安规间距合格。`, item.basis);
  }
  for (const item of context.isolation ?? []) {
    const required = ['standard', 'workingVoltageV', 'pollutionDegree', 'materialGroup', 'altitudeM', 'basis'];
    const missing = required.filter(k => item[k] === undefined);
    const unknownRefs = item.refs.filter(ref => !components.has(ref));
    for (const [kind, measuredKey, minimumKey] of [['电气间隙', 'measuredClearanceMm', 'requiredClearanceMm'], ['爬电距离', 'measuredCreepageMm', 'requiredCreepageMm']]) {
      const measured = item[measuredKey], minimum = item[minimumKey];
      const unknown = missing.length || unknownRefs.length || !item.refs.length || measured === undefined || minimum === undefined;
      add('ISOLATION', unknown ? 'unknown' : measured < minimum ? 'warning' : 'checked', `${item.id}：${kind}${unknown ? '待确认' : measured < minimum ? '低于提供的限值' : '提供的测量值满足提供的限值'}`, item.refs,
        unknown ? `缺少工况/依据: ${missing.join('、') || '无'}；测量值=${measured ?? '缺失'}，限值=${minimum ?? '缺失'}；未知位号=${unknownRefs.join('、') || (!item.refs.length ? '未指定' : '无')}。` : `测量 ${measured} mm ≥ 要求 ${minimum} mm 的比较结果为 ${measured >= minimum}。测量与限值均来自项目配置，插件未从铜皮几何重新测量，也未验证标准选用与条款适用性。`, item.basis ?? sources.isolation.title);
    }
  }
  if (!(context.signals?.length || context.decoupling?.length || context.proximity?.length || context.isolation?.length)) {
    add('COVERAGE', 'unknown', '尚未配置项目检查点', [], '已读取器件与网络。请声明目标引脚、信号类型、参考地及有依据的规则，再执行检查。', '未提供项目设计意图');
  }
  const counts = Object.fromEntries(['warning', 'unknown', 'checked', 'not_applicable'].map(s => [s, findings.filter(f => f.status === s).length]));
  return { schemaVersion: 1, project: board.project, revision: digest({ board: input, context }), evaluatedAt: new Date().toISOString(),
    summary: counts, conclusion: counts.warning ? '发现需处理的问题' : counts.unknown ? '存在待确认项' : '已配置的局部检查完成，仍需工程评审',
    humanReviewRequired: true, boardCounts: { components: board.components.length, nets: board.nets.length }, findings,
    coverage: { connectivity: '仅已声明引脚的直接网表拓扑', placement: '仅已声明器件对的参考点距离', isolation: '仅比较提供的测量值与限值',
      notChecked: ['完整 ERC/DRC', '铜皮/过孔/板槽几何', '爬电路径测量', '实际走线与回流连续性', '阻抗/时序/EMC', '工艺能力合规', '具体器件 datasheet 参数'] },
    notes: board.notes ?? [] };
}

const cell = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}|!]/g, '\\$&').replace(/[\r\n]+/g, ' ');
const location = f => f.pin ? `${f.refs[0]}.${f.pin}${f.refs.length > 1 ? '；关联 ' + f.refs.slice(1).join(', ') : ''}` : f.refs.join(', ');
export function toMarkdown(report) {
  const statuses = { warning: '需处理', unknown: '待确认', checked: '局部检查符合', not_applicable: '不适用' };
  return `# ${cell(report.project)} · 原理图与 PCB 评审\n\n${report.conclusion}。需处理 ${report.summary.warning} 项，待确认 ${report.summary.unknown} 项。\n\n快照：\`${report.revision}\`\n\n| 状态 | 检查点 | 位置 | 证据与建议 | 依据 |\n|---|---|---|---|---|\n` +
    report.findings.map(f => `| ${statuses[f.status]} | ${cell(f.title)} | ${cell(location(f))}${f.net ? ' / ' + cell(f.net) : ''} | ${cell(f.details)} | ${cell(f.basis)} |`).join('\n') +
    `\n\n## 覆盖范围\n\n- ${report.coverage.connectivity}\n- ${report.coverage.placement}\n- ${report.coverage.isolation}\n\n未检查：${report.coverage.notChecked.join('、')}。本报告不能作为整板合格或安规认证结论。\n` +
    report.notes.map(n => `\n- ${cell(n)}`).join('') + '\n';
}
