// Keep source spans: edits leave untouched schematic objects byte-for-byte intact.
export function parse(source) {
  if (typeof source !== 'string' || source.length > 32 * 1024 * 1024) throw new Error('S-expression exceeds 32 MiB');
  let i = 0, count = 0;
  const space = () => { while (i < source.length && /\s/.test(source[i])) i++; };
  function read(depth) {
    if (depth > 120 || ++count > 1000000) throw new Error('S-expression too complex');
    space(); const start = i;
    if (source[i] === '(') {
      i++; const children = []; space();
      while (i < source.length && source[i] !== ')') { children.push(read(depth + 1)); space(); }
      if (source[i++] !== ')') throw new Error(`Unclosed S-expression at ${start}`);
      return { start, end: i, children };
    }
    if (source[i] === '"') {
      i++; let value = '', closed = false;
      while (i < source.length) {
        const c = source[i++];
        if (c === '"') { closed = true; break; }
        if (c === '\\') { const e = source[i++]; if (e === undefined) break; value += ({ n: '\n', r: '\r', t: '\t' })[e] ?? e; }
        else value += c;
      }
      if (!closed) throw new Error(`Unclosed string at ${start}`);
      return { start, end: i, value };
    }
    while (i < source.length && !/[\s()"]/.test(source[i])) i++;
    if (i === start) throw new Error(`Unexpected token at ${i}`);
    return { start, end: i, value: source.slice(start, i) };
  }
  const root = read(0); space();
  if (i !== source.length || !root.children) throw new Error('Expected exactly one S-expression');
  return root;
}
export const tag = n => n?.children?.[0]?.value;
export const nodes = (n, name) => (n?.children ?? []).filter(c => tag(c) === name);
export const node = (n, name) => nodes(n, name)[0];
export const value = (n, name, index = 1) => node(n, name)?.children[index]?.value;
export const prop = (n, name) => nodes(n, 'property').find(p => p.children[1]?.value === name);
export const property = (n, name) => prop(n, name)?.children[2]?.value ?? '';
export const quote = v => JSON.stringify(String(v));
export const raw = (source, n) => source.slice(n.start, n.end);
export function schematic(source) {
  const root = parse(source);
  if (tag(root) !== 'kicad_sch' || !value(root, 'uuid') || !node(root, 'lib_symbols')) throw new Error('Not a modern KiCad schematic');
  return root;
}
export function placements(source) {
  return nodes(schematic(source), 'symbol').map(s => ({
    ref: property(s, 'Reference'), uuid: value(s, 'uuid'), libId: value(s, 'lib_id'),
    unit: Number(value(s, 'unit') ?? 1), value: property(s, 'Value'), footprint: property(s, 'Footprint'),
    dnp: value(s, 'dnp') === 'yes', inBom: value(s, 'in_bom') !== 'no', onBoard: value(s, 'on_board') !== 'no',
    at: node(s, 'at')?.children.slice(1).map(x => Number(x.value)) ?? [],
    properties: Object.fromEntries(nodes(s, 'property').map(p => [p.children[1].value, p.children[2].value])),
  }));
}
export function edit(source, edits) {
  const ordered = [...edits].sort((a, b) => b.start - a.start); let boundary = source.length;
  for (const e of ordered) {
    if (e.end > boundary) throw new Error('Overlapping edits');
    source = source.slice(0, e.start) + e.text + source.slice(e.end); boundary = e.start;
  }
  return source;
}
export function setProperties(source, ref, properties) {
  const symbols = nodes(schematic(source), 'symbol').filter(s => property(s, 'Reference') === ref);
  if (!symbols.length) throw new Error(`Unknown component ${ref}`);
  const edits = [];
  for (const s of symbols) {
    const add = [];
    for (const [key, v] of Object.entries(properties)) {
      if (['Reference', 'Sheetfile', 'Sheetname'].includes(key)) throw new Error(`Cannot change ${key} with set_properties`);
      if (['dnp', 'in_bom', 'on_board'].includes(key)) {
        if (typeof v !== 'boolean') throw new Error(`${key} requires boolean`);
        const n = node(s, key), text = `(${key} ${v ? 'yes' : 'no'})`;
        if (n) edits.push({ ...n, text }); else add.push(text);
      } else {
        if (typeof v !== 'string' || v.length > 10000) throw new Error('Property requires a short string');
        const p = prop(s, key);
        if (p) edits.push({ ...p.children[2], text: quote(v) });
        else add.push(`(property ${quote(key)} ${quote(v)} (at ${value(s, 'at')} ${value(s, 'at', 2)} 0) (effects (font (size 1.27 1.27)) hide))`);
      }
    }
    if (add.length) edits.push({ start: s.end - 1, end: s.end - 1, text: '\n' + add.join('\n') });
  }
  return edit(source, edits);
}
const editable = new Set(['symbol', 'wire', 'junction', 'label', 'global_label', 'no_connect', 'text', 'text_box', 'polyline', 'rectangle', 'circle', 'arc', 'bus', 'bus_entry', 'netclass_flag']);
export function patch(source, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 1000) throw new Error('Expected 1..1000 patch operations');
  for (const op of operations) {
    if (op.op === 'set_properties') { source = setProperties(source, op.ref, op.properties); continue; }
    const root = schematic(source);
    if (op.op === 'upsert_library_symbol') {
      const entry = parse(op.sexpr);
      if (tag(entry) !== 'symbol' || !entry.children[1]?.value) throw new Error('Expected library symbol');
      const libs = node(root, 'lib_symbols'), old = nodes(libs, 'symbol').find(n => n.children[1].value === entry.children[1].value);
      source = edit(source, [old ? { ...old, text: op.sexpr } : { start: libs.end - 1, end: libs.end - 1, text: '\n' + op.sexpr }]);
      continue;
    }
    if (!['insert', 'replace', 'delete'].includes(op.op)) throw new Error(`Unknown operation ${op.op}`);
    let old;
    if (op.op !== 'insert') {
      const found = root.children.filter(n => editable.has(tag(n)) && value(n, 'uuid') === op.uuid);
      if (found.length !== 1) throw new Error('UUID must identify one editable top-level object');
      old = found[0];
    }
    if (op.op === 'delete') source = edit(source, [{ ...old, text: '' }]);
    else {
      const entry = parse(op.sexpr);
      if (!editable.has(tag(entry)) || !value(entry, 'uuid')) throw new Error('Expected editable object with UUID');
      if (old && value(entry, 'uuid') !== op.uuid) throw new Error('Replacement must preserve UUID');
      source = edit(source, [old ? { ...old, text: op.sexpr } : { start: root.end - 1, end: root.end - 1, text: '\n' + op.sexpr + '\n' }]);
    }
  }
  const ids = nodes(schematic(source), 'symbol').concat(schematic(source).children.filter(n => editable.has(tag(n)) && tag(n) !== 'symbol')).map(n => value(n, 'uuid')).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate top-level UUID');
  return source;
}

// Full target synchronization keeps existing single-sheet component links to the PCB.
export function synchronize(current, target, projectName) {
  const a = schematic(current), b = schematic(target);
  if (nodes(a, 'sheet').length || nodes(b, 'sheet').length) throw new Error('Automatic synchronization currently requires a single sheet; compare supports hierarchies');
  const oldSymbols = new Map(nodes(a, 'symbol').map(s => [`${property(s, 'Reference')}:${value(s, 'unit') ?? '1'}`, s]));
  const replacements = new Map([[value(b, 'uuid'), value(a, 'uuid')]]);
  for (const s of nodes(b, 'symbol')) {
    const old = oldSymbols.get(`${property(s, 'Reference')}:${value(s, 'unit') ?? '1'}`);
    if (old) replacements.set(value(s, 'uuid'), value(old, 'uuid'));
  }
  const edits = [];
  function walk(n, parent) {
    if (n.children) for (const c of n.children) walk(c, n);
    else if (['uuid', 'path', 'project'].includes(tag(parent)) && parent.children[1] === n) {
      const next = tag(parent) === 'project' ? projectName : tag(parent) === 'path'
        ? n.value.split('/').map(p => replacements.get(p) ?? p).join('/') : replacements.get(n.value) ?? n.value;
      if (next !== n.value) edits.push({ ...n, text: quote(next) });
    }
  }
  walk(b); return edit(target, edits);
}
