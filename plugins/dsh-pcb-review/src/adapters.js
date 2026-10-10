import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse } from 'csv-parse/sync';
import { validateBoard } from './validation.js';

const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'object' && value ? String(value['#text'] ?? '') : String(value ?? '');
export function parseKiCad(xml, project = 'KiCad project') {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不接受带 DTD / ENTITY 的网表');
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`XML 格式错误: ${valid.err.msg}`);
  const root = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, trimValues: true }).parse(xml).export;
  if (!root?.components || !root?.nets) throw new Error('需要 KiCad XML 导出网表（export/components/nets）');
  const components = list(root.components.comp).map(c => {
    const properties = list(c.property);
    const kind = /^C(?:_|$)/.test(text(c.libsource?.['@_part'])) || /^C\d/.test(c['@_ref']) ? 'capacitor' : undefined;
    return {
      ref: c['@_ref'], value: text(c.value) || '(未填写)',
      ...(text(c.footprint) ? { footprint: text(c.footprint) } : {}),
      ...(kind ? { kind } : {}),
      dnp: properties.some(p => String(p['@_name']).toLowerCase() === 'dnp' && !['no', 'false', '0'].includes(String(p['@_value']).toLowerCase())),
    };
  });
  return validateBoard({ schemaVersion: 1, project, source: 'kicad-xml', components,
    nets: list(root.nets.net).map(n => ({ name: n['@_name'], nodes: list(n.node).map(p => ({ ref: p['@_ref'], pin: p['@_pin'] })) })),
    notes: ['仅检查导出快照；串联电阻、磁珠与跨线不自动合并网络。'] });
}

export function parseProtel(input, project = 'Altium project') {
  // Protel ASCII: [ ref / footprint / value / optional attributes ] and ( net / ref-pin ... ).
  // Keep empty footprint/value lines: they are positional fields.
  const lines = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const components = [], nets = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line !== '[' && line !== '(') throw new Error(`Protel 网表第 ${i + 1} 行不是支持的块起点`);
    const close = line === '[' ? ']' : ')', block = [];
    for (i++; i < lines.length && lines[i].trim() !== close; i++) block.push(lines[i].trim());
    if (i === lines.length) throw new Error('Protel 网表块未闭合');
    if (line === '[') {
      if (block.length < 3) throw new Error('Protel 元器件块缺少 ref / footprint / value');
      const [ref, footprint, value] = block;
      components.push({ ref, value: value || '(未填写)', ...(footprint ? { footprint } : {}),
        ...(/^C\d/.test(ref) ? { kind: 'capacitor' } : {}), dnp: null });
    } else {
      const [name, ...nodes] = block;
      nets.push({ name, nodes: nodes.filter(Boolean).map(node => {
        const at = node.lastIndexOf('-');
        if (at < 1 || at === node.length - 1) throw new Error(`不支持的 Protel 节点: ${node}`);
        return { ref: node.slice(0, at), pin: node.slice(at + 1) };
      }) });
    }
  }
  return validateBoard({ schemaVersion: 1, project, source: 'altium-protel', components, nets,
    notes: ['Protel 网表不证明装配变体；请用 componentOverrides 指定 DNP，或确认 allListedFitted。', '仅读取导出数据，不解析 SchDoc / PcbDoc 二进制。'] });
}

export function applyPositions(board, csv) {
  const rows = parse(csv.replace(/^\uFEFF/, ''), { columns: true, skip_empty_lines: true, trim: true, bom: true });
  if (rows.length > 20000) throw new Error('位置记录过多');
  const refs = new Map(board.components.map(c => [c.ref, c])), seen = new Set(), unused = [];
  for (const row of rows) {
    // KiCad CSV is exported with --units mm. AD data must use canonical ref,x,y,side headers in mm.
    const ref = row.ref ?? row.Ref;
    if (!ref || seen.has(ref)) throw new Error(`位置表缺少或重复位号: ${ref}`);
    seen.add(ref);
    const x = row.x ?? row.PosX, y = row.y ?? row.PosY;
    if (x === undefined || y === undefined || !String(x).trim() || !String(y).trim()) throw new Error(`位置表缺少坐标: ${ref}`);
    const position = { x: Number(x), y: Number(y), side: row.side ?? row.Side ?? 'unknown' };
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error(`坐标必须是毫米数字: ${ref}`);
    if (refs.has(ref)) refs.get(ref).position = position; else unused.push(ref);
  }
  board.notes ??= [];
  board.notes.push('坐标为封装参考点，单位 mm；不能用于计算焊盘间电气间隙、爬电距离或真实回流路径。');
  if (unused.length) board.notes.push(`位置表中 ${unused.length} 个位号不在网表中，未纳入检查：${unused.slice(0, 20).join(', ')}`);
  return validateBoard(board);
}
