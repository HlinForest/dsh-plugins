import { createHash } from 'node:crypto';
export const hash = data => createHash('sha256').update(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)).digest('hex');
export const kinds = ['datasheet', 'selection', 'schematic-review', 'pcb-review', 'compare', 'align'];
export const engine = { name: 'workbench-rules', version: '1.0.0' };
export function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').trim().replace(/[ΩΩ]/g, '').replace(/ohms?$/i, '').replace(/\s+/g, '');
  const mid = s.match(/^(\d+)([RrKkMmµunp])(\d+)$/);
  if (mid) return Number(mid[1] + '.' + mid[3]) * ({ R: 1, r: 1, k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12 }[mid[2]]);
  const m = s.match(/^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([RrKkMmµunp]?)(?:[FHVWA])?$/);
  return m ? Number(m[1]) * ({ '': 1, R: 1, r: 1, k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12 }[m[2]]) : null;
}
export function metric(spec) {
  const p = Object.fromEntries(Object.entries(spec.inputs ?? {}).map(([k, v]) => [k, number(v)]));
  const formulas = {
    divider: { keys: ['vin', 'rTop', 'rBottom'], positive: ['rTop', 'rBottom'], formula: 'Vout = Vin × Rbottom / (Rtop + Rbottom)', unit: 'V', calc: () => p.vin * p.rBottom / (p.rTop + p.rBottom) },
    rc: { keys: ['r', 'c'], positive: ['r', 'c'], formula: 'fc = 1 / (2πRC)', unit: 'Hz', calc: () => 1 / (2 * Math.PI * p.r * p.c) },
    current: { keys: ['vin', 'vf', 'r'], positive: ['r'], formula: 'I = (Vin − Vf) / R', unit: 'A', calc: () => (p.vin - p.vf) / p.r },
    power: { keys: ['current', 'r'], positive: ['r'], formula: 'P = I²R', unit: 'W', calc: () => p.current ** 2 * p.r },
    ldo: { keys: ['vin', 'vout', 'current'], positive: [], formula: 'P = (Vin − Vout) × I', unit: 'W', calc: () => (p.vin - p.vout) * p.current },
  };
  const f = formulas[spec.kind];
  if (!f) throw new Error('不支持的计算类型。');
  const boundsValid = (spec.min === undefined || Number.isFinite(spec.min)) && (spec.max === undefined || Number.isFinite(spec.max)) && !(spec.min !== undefined && spec.max !== undefined && spec.min > spec.max);
  const physical = spec.kind === 'ldo' ? p.current >= 0 && p.vin >= p.vout && p.vout >= 0 : spec.kind === 'current' ? p.vin >= p.vf && p.vf >= 0 : true;
  const valid = f.keys.every(k => p[k] !== null && p[k] !== undefined) && f.positive.every(k => p[k] > 0) && physical && boundsValid;
  const result = valid ? f.calc() : null;
  return { id: spec.id, kind: spec.kind, formula: f.formula, inputs: p, unit: f.unit, value: Number.isFinite(result) ? result : null,
    status: !valid || !Number.isFinite(result) || !spec.conditions?.trim() || !spec.evidence?.some(e => e.quote?.trim()) ? 'unknown' : spec.min !== undefined && result < spec.min || spec.max !== undefined && result > spec.max ? 'fail' : 'pass',
    conditions: spec.conditions || '', evidence: spec.evidence || [], requirement: { min: spec.min, max: spec.max, specified: Number.isFinite(spec.min) || Number.isFinite(spec.max) }, engine };
}
export const terminal = (component, pin) => `${component}::${pin}`;
export function calibrate(sourcePoints, targetPoints, flipY = false) {
  if (![sourcePoints, targetPoints].every(points => Array.isArray(points) && points.length === 2 && points.every(p => p?.length >= 2 && p.slice(0,2).every(Number.isFinite)))) throw new Error('校准需要两组真实坐标。');
  const q = targetPoints.map(p => [p[0], p[1] * (flipY ? -1 : 1)]), p = sourcePoints;
  const u = [q[1][0]-q[0][0], q[1][1]-q[0][1]], v = [p[1][0]-p[0][0], p[1][1]-p[0][1]], d = u[0]**2 + u[1]**2;
  if (d < 1e-6 || v[0]**2 + v[1]**2 < 1e-6) throw new Error('两个校准器件不能位于同一点。');
  const a = (u[0]*v[0] + u[1]*v[1])/d, b = (u[0]*v[1] - u[1]*v[0])/d;
  return { a, b, tx: p[0][0]-a*q[0][0]+b*q[0][1], ty: p[0][1]-b*q[0][0]-a*q[0][1], flipY, scale: Math.hypot(a,b) };
}
export function transform(point, matrix) {
  if (!point?.length || !matrix) return point;
  const [x, yy] = point, y = yy * (matrix.flipY ? -1 : 1);
  return [matrix.a*x-matrix.b*y+matrix.tx, matrix.b*x+matrix.a*y+matrix.ty, ...(point.length > 2 ? point.slice(2) : [])];
}
export function netIndex(design) {
  const result = new Map();
  for (const net of design.nets || []) for (const p of net.nodes) result.set(terminal(p.component, p.pin), net);
  return result;
}
export function suggestMappings(a, b) {
  const used = new Set(), rows = [];
  for (const c of a.components) {
    const exact = b.components.filter(d => !used.has(d.id) && d.ref === c.ref);
    const candidates = exact.length === 1 ? exact : b.components.filter(d => !used.has(d.id) && d.value === c.value && d.libId === c.libId && d.footprint === c.footprint);
    const d = candidates.length === 1 ? candidates[0] : null;
    if (d) used.add(d.id);
    rows.push({ left: c.id, right: d?.id || '', confirmed: false, reason: exact.length === 1 ? '位号建议；请核对引脚定义' : '属性建议；不证明型号可互换', pins: {} });
  }
  return rows;
}
export function compare(a, b, mappings, metrics = []) {
  const left = new Map(a.components.map(c => [c.id, c])), right = new Map(b.components.map(c => [c.id, c]));
  const used = new Set(), pairs = new Map(), differences = [];
  const add = (layer, kind, objects, before, after, unknown = false) => differences.push({ id: hash([layer, kind, objects]).slice(0, 20), layer, kind, objects, before, after, status: unknown ? 'unknown' : 'different' });
  for (const m of mappings) {
    if (!left.has(m.left) || m.right && (!right.has(m.right) || used.has(m.right)) || pairs.has(m.left)) throw new Error('对应关系必须唯一，且引用当前快照中的对象。');
    if (m.pins && new Set(Object.values(m.pins)).size !== Object.values(m.pins).length) throw new Error('引脚对应不能多对一。');
    if (m.right) { used.add(m.right); pairs.set(m.left, m); }
  }
  for (const c of a.components) {
    const m = pairs.get(c.id), d = right.get(m?.right);
    if (!d) { add('components', 'unmatched-source', [c.id], c.ref, null, true); continue; }
    if (!m.confirmed) add('components', 'mapping-unconfirmed', [c.id, d.id], c.ref, d.ref, true);
    for (const key of ['value', 'libId', 'footprint', 'dnp']) {
      const av = c[key], bv = d[key];
      const knownEmptyFootprint = key === 'footprint' && av === '' && bv === '' && a.format !== 'reference' && b.format !== 'reference';
      if (av === undefined || av === null || bv === undefined || bv === null || key !== 'dnp' && (!av || !bv) && !knownEmptyFootprint) { add('components', `${key}-unknown`, [c.id, d.id], av, bv, true); continue; }
      const sameValue = key === 'value' && /^[RCL]\d/.test(c.ref) && number(av) !== null && number(av) === number(bv);
      if (av !== bv && !sameValue) add('components', key, [c.id, d.id], av, bv, !m.confirmed || [c, d].some(p => p.evidence && p.evidence.verification !== 'human-reviewed'));
    }
    const mappedPins = (c.pins || []).map(p => String(m.pins?.[p.number] || p.number)).sort();
    if (JSON.stringify(mappedPins) !== JSON.stringify((d.pins || []).map(p => String(p.number)).sort())) add('components', 'pin-definition', [c.id, d.id], c.pins, d.pins);
    else if ((c.pins || []).some(p => { const q = d.pins.find(q => String(q.number) === String(m.pins?.[p.number] || p.number)); return p.name && q?.name && p.name !== q.name || p.type && q?.type && p.type !== q.type; })) add('components', 'pin-role', [c.id, d.id], c.pins, d.pins);
    if (JSON.stringify(c.at) !== JSON.stringify(d.at)) add('layout', 'position', [c.id, d.id], c.at, d.at);
  }
  for (const d of b.components) if (!used.has(d.id)) add('components', 'unmatched-target', [d.id], null, d.ref, true);
  const ai = netIndex(a), bi = netIndex(b);
  for (const c of a.components) {
    const m = pairs.get(c.id); if (!m) continue;
    for (const pin of c.pins || []) {
      const an = ai.get(terminal(c.id, pin.number)), bn = bi.get(terminal(m.right, m.pins?.[pin.number] || pin.number));
      const signature = (net, source) => (net?.nodes || []).map(n => {
        if (!source) return terminal(n.component, n.pin);
        const x = pairs.get(n.component); return x ? terminal(x.right, x.pins?.[n.pin] || n.pin) : `unmapped:${terminal(n.component, n.pin)}`;
      }).sort();
      const sa = signature(an, true), sb = signature(bn, false);
      if (JSON.stringify(sa) !== JSON.stringify(sb)) add('connectivity', 'pin-net', [c.id, m.right, String(pin.number)], sa, sb, !m.confirmed || a.coverage?.connectivity !== 'complete' || b.coverage?.connectivity !== 'complete');
      else if (an && bn && an.name !== bn.name) add('names', 'net-name-only', [c.id, m.right, String(pin.number)], an.name, bn.name);
    }
  }
  const functional = metrics.map(pair => {
    const x = metric(pair.left), y = metric(pair.right), tolerance = pair.tolerance ?? 0.000001;
    return { id: pair.id, left: x, right: y, status: x.status === 'unknown' || y.status === 'unknown' || !Number.isFinite(tolerance) || tolerance < 0 || x.kind !== y.kind || x.conditions !== y.conditions ? 'unknown' : Math.abs(x.value - y.value) <= tolerance ? 'pass' : 'fail', requirements: x.status === 'unknown' || y.status === 'unknown' || !x.requirement.specified || !y.requirement.specified ? 'unknown' : x.status === 'fail' || y.status === 'fail' ? 'fail' : 'pass' };
  });
  const complete = a.coverage?.connectivity === 'complete' && b.coverage?.connectivity === 'complete' && a.components.length > 0 && b.components.length > 0;
  return { differences, mappings, functional, conclusions: {
    components: differences.some(d => d.layer === 'components' && d.status === 'different') ? 'fail' : differences.some(d => d.layer === 'components') ? 'unknown' : 'pass',
    connectivity: differences.some(d => d.layer === 'connectivity' && d.status === 'different') ? 'fail' : !complete || mappings.some(m => !m.confirmed) || pairs.size !== a.components.length || used.size !== b.components.length ? 'unknown' : 'pass',
    functional: !functional.length || functional.some(m => m.status === 'unknown') ? 'unknown' : functional.some(m => m.status === 'fail') ? 'fail' : 'pass',
    requirements: !functional.length || functional.some(m => m.requirements === 'unknown') ? 'unknown' : functional.some(m => m.requirements === 'fail') ? 'fail' : 'pass',
    fullCircuitEquivalence: 'not_performed',
  }, coverage: { left: a.coverage, right: b.coverage }, engine };
}
export function reviewRules(design, checks = []) {
  const index = netIndex(design), components = new Map(design.components.map(c => [c.id, c]));
  return checks.map(check => {
    const result = { id: check.id, rule: check.kind, status: 'unknown', objects: check.objects || [], evidence: check.evidence || [], conditions: check.conditions || '', engine, inputVersion: design.version, coverage: design.coverage };
    if (['divider', 'rc', 'current', 'power', 'ldo'].includes(check.kind)) return { ...result, ...metric(check) };
    if (check.kind === 'voltage-domain') {
      const p = check.inputs || {}, values = ['driverMin', 'driverMax', 'receiverMin', 'receiverMax'].map(k => number(p[k]));
      if (values.every(v => v !== null) && values[0] <= values[1] && values[2] <= values[3] && result.evidence.some(e => e.quote?.trim()) && result.conditions.trim()) result.status = values[0] >= values[2] && values[1] <= values[3] ? 'pass' : 'fail';
      return result;
    }
    if (!['decoupling', 'pullup'].includes(check.kind)) throw new Error(`未知规则：${check.kind}`);
    const net = index.get(terminal(check.component, check.pin)), other = design.nets.find(n => n.name === check.returnNet);
    if (!net || !other || net === other || design.coverage?.connectivity !== 'complete' || !result.evidence.some(e => e.quote?.trim())) { result.reason = !net || !other || net === other ? '请选择不同的完整网络名与有效引脚；跨页同名网络不自动合并。' : '连接覆盖或规则证据不足。'; return result; }
    const kind = check.kind === 'decoupling' ? 'C' : 'R';
    const matches = design.components.filter(c => c.ref.startsWith(kind) && c.dnp === false && c.pins?.length === 2 &&
      c.pins.some(p => net.nodes.some(n => n.component === c.id && n.pin === p.number)) && c.pins.some(p => other.nodes.some(n => n.component === c.id && n.pin === p.number)));
    result.objects = [check.component, ...matches.map(c => c.id)];
    result.status = matches.length ? 'pass' : 'fail';
    if (!components.has(check.component) || design.components.some(c => c.ref.startsWith(kind) && c.dnp === null)) result.status = 'unknown';
    result.reason = matches.length ? '发现已装配的直接跨接器件；未据此判断实际布局距离。' : '未发现要求的直接跨接器件。';
    return result;
  });
}
