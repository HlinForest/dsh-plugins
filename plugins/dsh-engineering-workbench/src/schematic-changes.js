import { schematic, placements, tag, nodes, node, value } from './engineering/sexpr.js';
const clean = n => n.children ? n.children.filter(c => !['uuid', 'instances'].includes(tag(c))).map(clean) : n.value;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const point = n => n?.children.slice(1, 3).map(v => Number(v.value));

function geometry(n) {
  if (!n) return null;
  const points = nodes(node(n, 'pts'), 'xy').map(point);
  if (!points.length && node(n, 'at')) points.push(point(node(n, 'at')));
  for (const key of ['start', 'end', 'center']) if (node(n, key)) points.push(point(node(n, key)));
  return points.length && points.every(p => p.every(Number.isFinite)) ? { kind: tag(n), points } : null;
}

// Actual baseline/candidate changes, independent of whether the target is satisfied.
// UUIDs match drawing objects; ref/unit matches component instances across versions.
export function schematicChanges(before, after) {
  const parts = { before: placements(before), after: placements(after) };
  const libraries = source => new Map(nodes(node(schematic(source), 'lib_symbols'), 'symbol').map(n => [n.children[1].value, n]));
  const la = libraries(before), lb = libraries(after);
  const symbolGeometry = (p, libraries) => {
    if (!p) return null;
    const points = [p.at.slice(0, 2)], angle = (p.at[2] || 0) * Math.PI / 180;
    for (const unit of nodes(libraries.get(p.libId), 'symbol')) for (const pin of nodes(unit, 'pin')) {
      const at = point(node(pin, 'at'));
      if (at?.every(Number.isFinite)) points.push([p.at[0] + at[0] * Math.cos(angle) - at[1] * Math.sin(angle), p.at[1] - at[0] * Math.sin(angle) - at[1] * Math.cos(angle)]);
    }
    return { kind: 'symbol', points };
  };
  const changes = [], componentKey = p => `${p.ref}:${p.unit}`;
  const a = new Map(parts.before.map(p => [componentKey(p), p]));
  const b = new Map(parts.after.map(p => [componentKey(p), p]));
  const labels = { value: '数值', footprint: '封装', libId: '符号', dnp: '不装配', at: '位置 / 方向', inBom: '物料表', onBoard: 'PCB 装配' };
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const old = a.get(key), next = b.get(key), p = next || old;
    const fields = !old || !next ? [{ name: '器件', before: old ? old.value : '无', after: next ? next.value : '无' }] :
      Object.entries(labels).filter(([f]) => !same(old[f], next[f])).map(([f, name]) => ({ name, before: old[f], after: next[f] }));
    if (old && next && !same(la.has(old.libId) ? clean(la.get(old.libId)) : null, lb.has(next.libId) ? clean(lb.get(next.libId)) : null)) fields.push({ name: '引脚 / 符号图形', before: '原符号排列', after: '已调整排列，请核对引脚号' });
    if (!fields.length) continue;
    changes.push({ id: 'part-' + key, kind: 'component', title: `${p.ref}${p.unit > 1 ? ' / 单元 ' + p.unit : ''}`, ref: p.ref, fields,
      before: symbolGeometry(old, la), after: symbolGeometry(next, lb) });
  }
  const types = { wire: '导线', junction: '连接点', label: '网络标签', global_label: '全局网络', no_connect: '未连接标记', text: '说明文字', polyline: '图形', rectangle: '框线', bus: '总线', bus_entry: '总线入口' };
  const drawings = source => new Map(schematic(source).children.filter(n => types[tag(n)] && value(n, 'uuid')).map(n => [value(n, 'uuid'), n]));
  const da = drawings(before), db = drawings(after);
  for (const id of new Set([...da.keys(), ...db.keys()])) {
    const old = da.get(id), next = db.get(id), n = next || old;
    if (old && next && same(clean(old), clean(next))) continue;
    const text = x => !x ? '无' : ['label', 'global_label', 'text'].includes(tag(x)) ? x.children[1].value : geometry(x)?.points.map(p => p.join(', ')).join(' → ') || types[tag(x)];
    changes.push({ id, kind: tag(n), title: (!old ? '新增' : !next ? '移除' : '调整') + types[tag(n)], fields: [{ name: types[tag(n)], before: text(old), after: text(next) }], before: geometry(old), after: geometry(next) });
  }
  return { parts, changes, counts: { components: changes.filter(c => c.kind === 'component').length, wires: changes.filter(c => c.kind === 'wire').length, other: changes.filter(c => !['component', 'wire'].includes(c.kind)).length } };
}
