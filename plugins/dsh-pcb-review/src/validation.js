export function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${label} 未知字段: ${key}`);
  return value;
}
export function string(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`${label} 必须是非空文本，最多 ${max} 字符`);
  return value;
}
export function array(value, label, max = 20000) {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} 必须是数组，最多 ${max} 项`);
  return value;
}
export function number(value, label, min = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`${label} 必须是 >= ${min} 的有限数字`);
  return value;
}
export function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} 不能重复`);
}
export function boolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} 必须为布尔值`);
}
export function enumeration(value, values, label) {
  if (!values.includes(value)) throw new Error(`${label} 必须为 ${values.join(', ')}`);
}
export const KINDS = ['mcu', 'adc', 'regulator', 'mosfet', 'isolator', 'crystal', 'connector', 'capacitor', 'resistor', 'diode', 'opamp', 'generic'];
export function validateBoard(board) {
  object(board, 'board', ['schemaVersion', 'project', 'source', 'components', 'nets', 'notes']);
  if (board.schemaVersion !== 1) throw new Error('board.schemaVersion 必须为 1');
  string(board.project, 'project');
  if (board.source !== undefined) string(board.source, 'source');
  if (board.notes !== undefined) array(board.notes, 'notes', 100).forEach(x => string(x, 'note'));
  array(board.components, 'components');
  if (!board.components.length) throw new Error('没有元器件，不能评审');
  unique(board.components.map(c => c.ref), '元器件位号');
  for (const c of board.components) {
    object(c, 'component', ['ref', 'value', 'footprint', 'kind', 'dnp', 'position']);
    string(c.ref, 'ref', 100); string(c.value, 'value');
    if (c.footprint !== undefined) string(c.footprint, 'footprint');
    if (c.kind !== undefined) enumeration(c.kind, KINDS, 'kind');
    if (c.dnp !== undefined && c.dnp !== null) boolean(c.dnp, 'dnp');
    if (c.position !== undefined) {
      object(c.position, 'position', ['x', 'y', 'side']);
      number(c.position.x, 'x', -1e6); number(c.position.y, 'y', -1e6);
      if (c.position.side !== undefined) string(c.position.side, 'side');
    }
  }
  array(board.nets, 'nets'); unique(board.nets.map(n => n.name), '网络名');
  const refs = new Set(board.components.map(c => c.ref)), pins = new Set();
  for (const net of board.nets) {
    object(net, 'net', ['name', 'nodes']); string(net.name, 'net.name'); array(net.nodes, 'nodes');
    for (const node of net.nodes) {
      object(node, 'node', ['ref', 'pin']); string(node.ref, 'node.ref', 100); string(node.pin, 'pin', 100);
      if (!refs.has(node.ref)) throw new Error(`网络引用未知器件 ${node.ref}`);
      const id = JSON.stringify([node.ref, node.pin]);
      if (pins.has(id)) throw new Error(`引脚重复或跨网: ${node.ref}.${node.pin}`);
      pins.add(id);
    }
  }
  return board;
}
export function validateContext(ctx = {}) {
  object(ctx, 'context', ['signals', 'decoupling', 'proximity', 'isolation', 'componentOverrides', 'allListedFitted']);
  if (ctx.allListedFitted !== undefined) boolean(ctx.allListedFitted, 'allListedFitted');
  for (const key of ['signals', 'decoupling', 'proximity', 'isolation', 'componentOverrides']) if (ctx[key] !== undefined) array(ctx[key], key, 1000);
  for (const key of ['signals', 'decoupling']) unique((ctx[key] ?? []).map(x => JSON.stringify([x.ref, x.pin])), key + ' 引脚');
  unique((ctx.isolation ?? []).map(x => x.id), 'isolation.id');
  for (const item of ctx.componentOverrides ?? []) {
    object(item, 'componentOverride', ['ref', 'kind', 'dnp']); string(item.ref, 'ref');
    if (item.kind !== undefined) enumeration(item.kind, KINDS, 'kind');
    if (item.dnp !== undefined) boolean(item.dnp, 'dnp');
  }
  unique((ctx.componentOverrides ?? []).map(c => c.ref), 'componentOverrides');
  for (const key of ['signals', 'decoupling']) for (const item of ctx[key] ?? []) {
    object(item, key, key === 'signals' ? ['ref', 'pin', 'kind', 'groundNet', 'capacitorPolicy', 'basis'] : ['ref', 'pin', 'groundNet', 'basis']);
    string(item.ref, 'ref'); string(item.pin, 'pin'); string(item.groundNet, 'groundNet');
    if (key === 'signals') {
      enumeration(item.kind, ['analog', 'digital', 'high_speed', 'unknown'], 'signal.kind');
      enumeration(item.capacitorPolicy, ['required', 'evaluate', 'forbidden'], 'capacitorPolicy');
      if (item.capacitorPolicy !== 'evaluate') string(item.basis, '强制规则的 basis');
    } else string(item.basis, '去耦检查的 basis');
    if (item.basis !== undefined) string(item.basis, 'basis');
  }
  for (const item of ctx.proximity ?? []) {
    object(item, 'proximity', ['ref', 'nearRef', 'maxMm', 'basis']);
    string(item.ref, 'ref'); string(item.nearRef, 'nearRef'); number(item.maxMm, 'maxMm'); string(item.basis, 'basis');
    if (item.ref === item.nearRef) throw new Error('邻近检查需要两个不同器件');
  }
  for (const item of ctx.isolation ?? []) {
    object(item, 'isolation', ['id', 'refs', 'standard', 'workingVoltageV', 'pollutionDegree', 'materialGroup', 'altitudeM', 'requiredClearanceMm', 'requiredCreepageMm', 'measuredClearanceMm', 'measuredCreepageMm', 'basis']);
    string(item.id, 'isolation.id'); array(item.refs, 'refs', 100).forEach(r => string(r, 'ref'));
    for (const k of ['standard', 'materialGroup', 'basis']) if (item[k] !== undefined) string(item[k], k);
    for (const k of ['workingVoltageV', 'pollutionDegree', 'altitudeM', 'requiredClearanceMm', 'requiredCreepageMm', 'measuredClearanceMm', 'measuredCreepageMm']) if (item[k] !== undefined) number(item[k], k);
  }
  return ctx;
}
