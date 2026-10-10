import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse, schematic, placements, nodes, node, value, property, prop, tag, raw, edit, quote, patch } from './sexpr.js';
import { run, readLimited } from './io.js';
const list = x => x === undefined ? [] : Array.isArray(x) ? x : [x];
const attr = (n, key) => n?.[`@_${key}`];
const values = n => n?.children ? n.children.map(values) : n?.value ?? null;
const structural = n => JSON.stringify(values(n));
export function boardInventory(text, document) {
  const root = parse(text); if (tag(root) !== 'kicad_pcb') throw new Error('不是 KiCad PCB 文件。');
  const netNames = new Map(nodes(root, 'net').map(n => [n.children[1]?.value, n.children[2]?.value])), nets = new Map();
  const components = nodes(root, 'footprint').map(f => {
    const uuid = value(f, 'uuid'), id = `${document}#${uuid}`, at = node(f, 'at')?.children.slice(1).map(n => Number(n.value)) || [0,0];
    const pins = nodes(f, 'pad').filter(p => p.children[1]?.value).map(p => {
      const number = p.children[1].value, name = value(p, 'net', 2) || netNames.get(value(p, 'net'));
      if (name) { if (!nets.has(name)) nets.set(name, { name, nodes: [] }); nets.get(name).nodes.push({ component: id, pin: number }); }
      return { number, uuid: value(p, 'uuid'), shape: p.children[3]?.value, size: node(p, 'size')?.children.slice(1).map(x => Number(x.value)), drill: value(p, 'drill') };
    });
    return { id, uuid, document, ref: property(f, 'Reference') || nodes(f, 'fp_text').find(n => n.children[1]?.value === 'reference')?.children[2]?.value || '', value: property(f, 'Value'), footprint: f.children[1]?.value, at, position: { x: at[0], y: at[1], side: value(f, 'layer') }, pins, dnp: node(f, 'attr')?.children.some(n => n.value === 'dnp') || false };
  });
  return { components, nets: [...nets.values()] };
}
export function inventory(text, document) {
  const root = schematic(text), libs = nodes(node(root, 'lib_symbols'), 'symbol');
  const components = placements(text).map(c => {
    const lib = libs.find(l => l.children[1]?.value === c.libId);
    const pinNodes = nodes(lib, 'symbol').filter(n => { const m = n.children[1]?.value?.match(/_(\d+)_(\d+)$/); return !m || Number(m[1]) === 0 || Number(m[1]) === c.unit; }).flatMap(n => nodes(n, 'pin'));
    const sym = nodes(root, 'symbol').find(s => value(s, 'uuid') === c.uuid), mirror = value(sym, 'mirror');
    const angle = (c.at[2] || 0) * Math.PI / 180;
    const pins = pinNodes.map(p => {
      let x = Number(value(p, 'at')), y = -Number(value(p, 'at', 2));
      if (mirror === 'x') y = -y; if (mirror === 'y') x = -x;
      return { number: value(p, 'number'), name: value(p, 'name'), type: p.children[1]?.value, at: [c.at[0] + x * Math.cos(angle) + y * Math.sin(angle), c.at[1] - x * Math.sin(angle) + y * Math.cos(angle)] };
    });
    return { ...c, id: `${document}#${c.uuid}`, document, pins };
  });
  const objects = root.children.filter(n => value(n, 'uuid') && ['symbol', 'wire', 'bus', 'junction', 'label', 'global_label', 'hierarchical_label', 'no_connect', 'text', 'polyline'].includes(tag(n))).map(n => ({
    id: `${document}#${value(n, 'uuid')}`, uuid: value(n, 'uuid'), document, kind: tag(n),
    text: raw(text, n), at: node(n, 'at')?.children.slice(1).map(x => Number(x.value)),
    points: nodes(node(n, 'pts'), 'xy').map(p => p.children.slice(1).map(x => Number(x.value))),
  }));
  return { components, objects, sheets: nodes(root, 'sheet').map(s => ({ uuid: value(s, 'uuid'), file: property(s, 'Sheetfile') })) };
}
export async function readKiCad(file, output, config, signal) {
  await fs.mkdir(output, { recursive: true });
  const documents = [], all = [], visited = new Map(), base = path.dirname(file);
  async function walk(filename, ancestors = []) {
    const rel = path.relative(base, filename).replaceAll('\\', '/');
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('子页必须位于工程目录内。');
    if (ancestors.includes(rel)) throw new Error('工程层级存在循环引用。');
    if (visited.has(rel)) {
      const doc = visited.get(rel); if (++doc.instances > 512) throw new Error('层级实例过多。');
      for (const s of doc.sheets) await walk(path.resolve(path.dirname(filename), s.file), [...ancestors, rel]);
      return;
    }
    if (documents.length >= 128) throw new Error('工程页数超过 128。');
    const text = (await readLimited(filename)).toString('utf8'), data = inventory(text, rel), doc = { id: rel, file: filename, instances: 1 };
    doc.sheets = data.sheets; visited.set(rel, doc); documents.push(doc); all.push(data);
    for (const s of data.sheets) await walk(path.resolve(path.dirname(filename), s.file), [...ancestors, rel]);
  }
  await walk(file);
  const xmlFile = path.join(output, 'netlist.xml');
  await run(config.kicadCli, ['sch', 'export', 'netlist', '--format', 'kicadxml', '-o', xmlFile, file], signal);
  const xml = (await readLimited(xmlFile)).toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('原生网表格式无效。');
  const graph = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml).export;
  if (!graph?.components || !graph.nets) throw new Error('KiCad 没有生成有效网表。');
  const components = all.flatMap(a => a.components).filter(c => !c.ref.startsWith('#'));
  // Instance identity comes from the native netlist, never a global reference lookup.
  const native = list(graph.components.comp), refIds = new Map(), instantiated = new Set(), instances = [];
  for (const c of native) {
    const ids = String(c.tstamps ?? '').split(/\s+/), candidates = components.filter(p => ids.includes(p.uuid));
    // Multi-unit symbols retain separate native object identities. Never pick the first
    // unit, or resolve an unknown UUID by a possibly duplicated display reference.
    if (new Set(candidates.map(p => p.uuid)).size !== candidates.length) continue;
    const physical = candidates.map(template => {
      instantiated.add(template.id);
      if (documents.find(d => d.id === template.document).instances === 1) return template;
      const instance = { ...template, id: `${template.document}@${attr(c.sheetpath, 'tstamps') || '/'}#${template.uuid}`, ref: attr(c, 'ref'), repeated: true };
      instances.push(instance); return instance;
    });
    refIds.set(attr(c, 'ref'), physical);
  }
  const active = [...components.filter(c => documents.find(d => d.id === c.document).instances === 1), ...instances];
  const nets = list(graph.nets.net).map(n => ({ name: attr(n, 'name'), nodes: list(n.node).flatMap(p => {
    const pin = String(attr(p, 'pin')), matches = (refIds.get(attr(p, 'ref')) || []).filter(c => c.pins.some(v => v.number === pin));
    return (matches.length ? matches : [null]).map(c => ({ component: c?.id, pin, ref: attr(p, 'ref') }));
  }) }));
  const renderDir = path.join(output, 'pages'); await fs.mkdir(renderDir, { recursive: true });
  await run(config.kicadCli, ['sch', 'export', 'svg', '--exclude-drawing-sheet', '-o', renderDir, file], signal);
  const previews = [];
  for (const name of (await fs.readdir(renderDir)).filter(n => n.endsWith('.svg')).sort()) {
    const svg = await fs.readFile(path.join(renderDir, name), 'utf8');
    const matching = documents.filter(d => path.basename(d.id, '.kicad_sch') === path.basename(name, '.svg'));
    previews.push({ file: path.join(renderDir, name), name, document: matching.length === 1 ? matching[0].id : documents.length === 1 ? documents[0].id : null, width: Number(svg.match(/width="([\d.]+)mm"/)?.[1]) || 297, height: Number(svg.match(/height="([\d.]+)mm"/)?.[1]) || 210 });
  }
  return { format: 'kicad', components: active, nets, documents, objects: all.flatMap(x => x.objects), previews,
    coverage: { connectivity: nets.some(n => n.nodes.some(p => !p.component)) || active.some(c => !c.pins.length || !c.repeated && !instantiated.has(c.id)) ? 'partial' : 'complete', assembly: 'native', hierarchy: documents.some(d => d.instances > 1) ? 'repeated-readonly' : 'unique' } };
}
export async function nativeCheck(file, output, config, signal, parity = false) {
  const pcb = path.extname(file).toLowerCase() === '.kicad_pcb', report = path.join(output, pcb ? 'drc.json' : 'erc.json');
  await run(config.kicadCli, [pcb ? 'pcb' : 'sch', pcb ? 'drc' : 'erc', '--format', 'json', '-o', report, ...(pcb && parity ? ['--schematic-parity'] : []), file], signal);
  const result = JSON.parse(await fs.readFile(report, 'utf8'));
  if (pcb ? !Array.isArray(result.violations) || !Array.isArray(result.unconnected_items) || parity && !Array.isArray(result.schematic_parity) : !Array.isArray(result.sheets) || result.sheets.some(s => !Array.isArray(s.violations))) throw new Error('原生检查结果缺少必要字段，不能判断通过。');
  const items = pcb ? [...result.violations, ...result.unconnected_items, ...(parity ? result.schematic_parity || [] : [])] : result.sheets.flatMap(s => s.violations || []);
  return { engine: { name: 'kicad-cli', version: (await run(config.kicadCli, ['--version'], signal)).trim() }, status: items.some(x => x.severity === 'error') ? 'fail' : items.length ? 'warning' : 'pass', violations: items, coverage: pcb ? ['DRC', 'unrouted', ...(parity ? ['schematic-parity'] : [])] : ['ERC'], report };
}
const near = (a, b) => Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001;
export function componentInsertion(source, target, fromId, newRef, at, componentValue) {
  if (!/^[A-Za-z]+[1-9]\d*$/.test(newRef)) throw new Error('请输入唯一且明确的位号。');
  const root = schematic(source), uuid = fromId.split('#').at(-1), sym = nodes(root, 'symbol').find(s => value(s, 'uuid') === uuid);
  if (!sym) throw new Error('模板器件不存在。');
  if (placements(target).some(c => c.ref === newRef)) throw new Error('位号已经存在。');
  const lib = nodes(node(root, 'lib_symbols'), 'symbol').find(l => l.children[1]?.value === value(sym, 'lib_id'));
  if (!lib || node(lib, 'extends')) throw new Error('需要包含完整引脚定义的符号。');
  const existing = nodes(node(schematic(target), 'lib_symbols'), 'symbol').find(l => l.children[1]?.value === value(sym, 'lib_id'));
  if (existing && structural(existing) !== structural(lib)) throw new Error('源工程已有同名但不同的符号定义。请先在 EDA 中分配唯一符号身份，避免影响其他器件。');
  const id = randomUUID(), rootId = value(schematic(target), 'uuid');
  return { op: 'add-component', symbol: raw(source, lib), instance: `(symbol (lib_id ${quote(value(sym, 'lib_id'))}) (at ${at[0]} ${at[1]} 0) (unit ${value(sym, 'unit') || 1}) (in_bom yes) (on_board yes) (dnp no) (uuid ${quote(id)}) (property "Reference" ${quote(newRef)} (at ${at[0]} ${at[1] - 3} 0) (effects (font (size 1.27 1.27)))) (property "Value" ${quote(componentValue || '')} (at ${at[0]} ${at[1] + 3} 0) (effects (font (size 1.27 1.27)))) (property "Footprint" ${quote(property(sym, 'Footprint'))} (at ${at[0]} ${at[1]} 0) (effects (font (size 1.27 1.27)) hide)) (property "Datasheet" "" (at ${at[0]} ${at[1]} 0) (effects (font (size 1.27 1.27)) hide)) (instances (project "engineering" (path ${quote('/' + rootId)} (reference ${quote(newRef)}) (unit ${value(sym, 'unit') || 1})))))` };
}
export function modifyKiCad(source, document, operations, grid = 1.27) {
  if (!Number.isFinite(grid) || grid <= 0 || grid > 25.4) throw new Error('无效网格。');
  const snap = x => Math.round(x / grid) * grid;
  const coordinate = v => { if (!Array.isArray(v) || v.length < 2 || !v.slice(0, 2).every(Number.isFinite)) throw new Error('坐标必须为数字。'); return v.slice(0, 2).map(snap); };
  for (const op of operations) {
    const data = inventory(source, document), root = schematic(source);
    const object = data.objects.find(o => o.id === op.id);
    const ast = object && root.children.find(n => value(n, 'uuid') === object.uuid);
    if (['properties', 'move', 'rotate', 'delete'].includes(op.op) && !ast) throw new Error('对象身份无效，请重新定位。');
    if (op.op === 'properties') {
      if (tag(ast) !== 'symbol') throw new Error('请先选择器件。');
      const changes = [];
      for (const [key, v] of Object.entries(op.properties || {})) {
        if (!['Value', 'Footprint', 'Datasheet', 'dnp'].includes(key)) throw new Error('此属性不允许修改。');
        const p = key === 'dnp' ? node(ast, key) : prop(ast, key);
        if (!p) throw new Error('原生对象缺少此属性。');
        if (key === 'dnp') { if (typeof v !== 'boolean') throw new Error('装配状态需要布尔值。'); changes.push({ ...p, text: `(dnp ${v ? 'yes' : 'no'})` }); }
        else { if (typeof v !== 'string') throw new Error('属性需要文本。'); changes.push({ ...p.children[2], text: quote(v) }); }
      }
      source = edit(source, changes);
    } else if (op.op === 'delete') source = patch(source, [{ op: 'delete', uuid: object.uuid }]);
    else if (op.op === 'move' || op.op === 'rotate') {
      const part = data.components.find(c => c.id === op.id);
      if (!part) throw new Error('移动和旋转需要选择器件。');
      const target = op.op === 'move' ? coordinate(op.at) : part.at.slice(0, 2), delta = [target[0] - part.at[0], target[1] - part.at[1]];
      const rotation = op.op === 'rotate' ? 90 : 0, changes = [];
      const transform = xy => rotation ? [target[0] + xy[1] - part.at[1], target[1] - xy[0] + part.at[0]] : [xy[0] + delta[0], xy[1] + delta[1]];
      const at = node(ast, 'at'); changes.push({ ...at, text: `(at ${target.join(' ')} ${((part.at[2] || 0) + rotation) % 360})` });
      for (const p of nodes(ast, 'property')) { const a = node(p, 'at'); if (a) { const xy = transform([Number(value(p, 'at')), Number(value(p, 'at', 2))]); changes.push({ ...a, text: `(at ${xy.join(' ')} ${value(p, 'at', 3) || 0})` }); } }
      source = edit(source, changes);
      // Preserve each old connection by extending from its original anchor to the moved pin.
      // Existing branch junctions, labels and other pins therefore retain their original nets.
      if (op.disconnect !== true) for (const pin of part.pins) {
        const a = pin.at, b = transform(a); if (near(a, b)) continue;
        const attached = data.objects.some(o => o.id !== op.id && (o.kind === 'wire' && o.points.some(p => near(p, a)) || ['junction', 'label', 'global_label'].includes(o.kind) && o.at && near(o.at, a))) || data.components.some(c => c.id !== op.id && c.pins.some(p => near(p.at, a)));
        if (attached) {
          const wires = data.objects.filter(o => o.kind === 'wire' && o.points.some(p => near(p, a)));
          const anchored = data.objects.some(o => ['junction', 'label', 'global_label'].includes(o.kind) && o.at && near(o.at, a)) || data.components.some(c => c.id !== op.id && c.pins.some(p => near(p.at, a)));
          if (wires.length === 1 && !anchored) {
            const wire = schematic(source).children.find(n => value(n, 'uuid') === wires[0].uuid);
            const edits = nodes(node(wire, 'pts'), 'xy').filter(p => near(p.children.slice(1).map(v => Number(v.value)), a)).map(p => ({ ...p, text: `(xy ${b.join(' ')})` }));
            source = edit(source, edits); continue;
          }
          const points = [a, b];
          for (let i = 1; i < points.length; i++) source = patch(source, [{ op: 'insert', sexpr: `(wire (pts (xy ${points[i - 1].join(' ')}) (xy ${points[i].join(' ')})) (stroke (width 0) (type default)) (uuid ${quote(randomUUID())}))` }]);
        }
      }
    } else if (op.op === 'wire') {
      const a = coordinate(op.from), b = coordinate(op.to); if (near(a, b)) throw new Error('导线长度不能为零。');
      source = patch(source, [{ op: 'insert', sexpr: `(wire (pts (xy ${a.join(' ')}) (xy ${b.join(' ')})) (stroke (width 0) (type default)) (uuid ${quote(randomUUID())}))` }]);
    } else if (op.op === 'junction' || op.op === 'label') {
      const at = coordinate(op.at), id = quote(randomUUID());
      if (op.op === 'label' && !op.text?.trim()) throw new Error('网络标注不能为空。');
      source = patch(source, [{ op: 'insert', sexpr: op.op === 'junction' ? `(junction (at ${at.join(' ')}) (diameter 0) (color 0 0 0 0) (uuid ${id}))` : `(label ${quote(op.text)} (at ${at.join(' ')} 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid ${id}))` }]);
    } else if (op.op === 'add-component') {
      if (!op.symbol || !op.instance) throw new Error('新增器件需要明确的原生符号和引脚定义。');
      const lib = parse(op.symbol); if (!nodes(lib, 'symbol').some(n => nodes(n, 'pin').length)) throw new Error('符号没有引脚定义。');
      const instance = parse(op.instance), name = lib.children[1]?.value;
      const existing = nodes(node(root, 'lib_symbols'), 'symbol').find(l => l.children[1]?.value === name);
      if (existing && structural(existing) !== structural(lib)) throw new Error('不能替换已有符号定义而影响其他器件。');
      if (tag(instance) !== 'symbol' || value(instance, 'lib_id') !== name || !value(instance, 'uuid') || data.objects.some(o => o.uuid === value(instance, 'uuid')) || data.components.some(c => c.ref === property(instance, 'Reference'))) throw new Error('新增器件的符号、身份或位号无效。');
      source = patch(source, [{ op: 'upsert_library_symbol', sexpr: op.symbol }, { op: 'insert', sexpr: op.instance }]);
    } else throw new Error(`不支持的编辑：${op.op}`);
  }
  schematic(source); return source;
}
