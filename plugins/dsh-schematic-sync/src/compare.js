import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { placements, schematic, raw, tag, value } from './sexpr.js';

const list = v => v === undefined ? [] : Array.isArray(v) ? v : [v];
const string = v => typeof v === 'object' && v ? String(v['#text'] ?? '') : String(v ?? '');
const pinKey = p => JSON.stringify([p.ref, p.pin]);
const sorted = xs => [...xs].sort();
const autoName = name => /^(?:.*\/)?(?:Net-\(|unconnected-\()/i.test(name);
export function parseNetlist(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Invalid or unsafe netlist XML');
  const x = new XMLParser({ ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false }).parse(xml).export;
  if (!x?.components || x.nets === undefined) throw new Error('Expected KiCad XML netlist');
  const components = list(x.components.comp).map(c => ({
    ref: c['@_ref'], value: string(c.value), footprint: string(c.footprint),
    libId: `${c.libsource?.['@_lib'] ?? ''}:${c.libsource?.['@_part'] ?? ''}`,
    dnp: list(c.property).some(p => p['@_name'] === 'dnp' && !['no', 'false', '0'].includes(String(p['@_value']).toLowerCase())),
    properties: Object.fromEntries(list(c.property).filter(p => !['Sheetname', 'Sheetfile', 'ki_keywords', 'ki_description'].includes(p['@_name'])).map(p => [p['@_name'], string(p['@_value'])])),
  }));
  if (new Set(components.map(c => c.ref)).size !== components.length) throw new Error('Duplicate component references in exported netlist');
  const nets = list(x.nets?.net).map(n => ({ name: n['@_name'], nodes: list(n.node).map(p => ({ ref: p['@_ref'], pin: p['@_pin'] })).sort((a, b) => pinKey(a).localeCompare(pinKey(b))) }));
  const seen = new Set();
  for (const net of nets) for (const pin of net.nodes) { const k = pinKey(pin); if (seen.has(k)) throw new Error(`Duplicate net pin ${k}`); seen.add(k); }
  return { components, nets };
}
export function compareNative(actual, expected, actualSource, expectedSource) {
  const differences = [], add = (kind, details) => differences.push({ kind, ...details });
  const a = new Map(actual.components.map(c => [c.ref, c])), b = new Map(expected.components.map(c => [c.ref, c]));
  for (const [ref, wanted] of b) {
    const got = a.get(ref);
    if (!got) { add('missing_component', { ref, expected: wanted }); continue; }
    for (const field of ['value', 'footprint', 'libId', 'dnp']) if (got[field] !== wanted[field]) add('component_property', { ref, field, actual: got[field], expected: wanted[field] });
    for (const key of sorted(new Set([...Object.keys(got.properties), ...Object.keys(wanted.properties)]))) {
      if (key === 'dnp') continue;
      if ((got.properties[key] ?? null) !== (wanted.properties[key] ?? null)) add('custom_property', { ref, field: key, actual: got.properties[key] ?? null, expected: wanted.properties[key] ?? null });
    }
  }
  for (const ref of a.keys()) if (!b.has(ref)) add('extra_component', { ref });
  const signature = n => JSON.stringify(n.nodes.map(pinKey).sort());
  const an = new Map(actual.nets.map(n => [signature(n), n]));
  const bn = new Map(expected.nets.map(n => [signature(n), n]));
  for (const [sig, n] of bn) {
    if (!an.has(sig)) add('target_connection', { expected: n });
    else if (!autoName(n.name) && n.name !== an.get(sig).name) add('net_name', { actual: an.get(sig).name, expected: n.name, nodes: n.nodes });
  }
  for (const [sig, n] of an) if (!bn.has(sig)) add('current_connection', { actual: n });
  // These include power flags and excluded symbols absent from the physical netlist.
  const pa = new Map(placements(actualSource).map(p => [`${p.ref}:${p.unit}`, p]));
  const pb = new Map(placements(expectedSource).map(p => [`${p.ref}:${p.unit}`, p]));
  for (const [key, p] of pb) {
    const q = pa.get(key);
    if (!q) add('missing_placement', { ref: p.ref, unit: p.unit });
    else for (const field of ['dnp', 'inBom', 'onBoard']) if (q[field] !== p[field]) add('symbol_flag', { ref: p.ref, field, actual: q[field], expected: p[field] });
  }
  for (const [key, p] of pa) if (!pb.has(key)) add('extra_placement', { ref: p.ref, unit: p.unit });
  const drawing = source => {
    const root = schematic(source);
    const clean = n => n.children
      ? n.children.filter(c => !['uuid', 'instances', 'generator', 'generator_version'].includes(tag(c)) && !(tag(c) === 'pin' && value(c, 'uuid') && !value(c, 'at'))).map(clean)
      : n.value;
    return JSON.stringify(root.children.filter(n => !['uuid', 'version', 'generator', 'generator_version', 'sheet_instances', 'embedded_fonts'].includes(tag(n))).map(clean));
  };
  const layoutMatches = drawing(actualSource) === drawing(expectedSource);
  return { scope: 'native_target', electricalMatches: differences.length === 0, layoutMatches,
    matches: differences.length === 0 && layoutMatches, differences,
    notes: ['Electrical equality uses exported component properties and sets of ref/pin endpoints; generated net names are ignored.', 'Layout comparison is structural, including symbols and drawing objects; it is not a pixel similarity metric.'] };
}

export function validateContract(data, sourceKind, sourceText = '') {
  if (!data || data.schemaVersion !== 1 || !['partial', 'complete'].includes(data.scope)) throw new Error('Contract needs schemaVersion:1 and scope:partial|complete');
  if (!Array.isArray(data.requirements) || !data.requirements.length || data.requirements.length > 1000) throw new Error('Contract needs 1..1000 requirements');
  if (!Array.isArray(data.unresolved) || data.unresolved.some(v => typeof v !== 'string')) throw new Error('Contract needs unresolved:string[]');
  const ids = new Set();
  for (const r of data.requirements) {
    if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id)) throw new Error('Each requirement needs unique id'); ids.add(r.id);
    if (!['component', 'absent', 'connected', 'disconnected'].includes(r.kind)) throw new Error(`Unsupported requirement ${r.kind}`);
    if (!r.evidence || typeof r.evidence.quote !== 'string' || !r.evidence.quote.trim()) throw new Error('Each requirement needs evidence.quote');
    if (sourceKind === 'text' && !sourceText.includes(r.evidence.quote)) throw new Error('Evidence quote must occur verbatim in original text');
    if (['image', 'pdf'].includes(sourceKind) && (!Number.isInteger(r.evidence.page) || r.evidence.page < 1)) throw new Error('Image/PDF evidence needs 1-based page');
    if (typeof r.certain !== 'boolean') throw new Error('Each requirement needs certain:boolean');
    if (['component', 'absent'].includes(r.kind)) {
      if (typeof r.ref !== 'string' || !r.ref || r.ref.includes('?')) throw new Error('Exact annotated ref required');
      if (r.kind === 'component') {
        if (!r.properties || !Object.keys(r.properties).length) throw new Error('component requires properties');
        for (const [k, v] of Object.entries(r.properties)) {
          if (!['value', 'footprint', 'libId', 'dnp'].includes(k) || (k === 'dnp' ? typeof v !== 'boolean' : typeof v !== 'string')) throw new Error('Allowed properties: value, footprint, libId, dnp');
        }
      }
    } else {
      if (!Array.isArray(r.pins) || r.pins.length < 2 || r.pins.some(p => !p || typeof p.ref !== 'string' || !p.ref || typeof p.pin !== 'string' || !p.pin)) throw new Error('Connection requires at least two exact {ref,pin} endpoints');
      if (new Set(r.pins.map(pinKey)).size !== r.pins.length) throw new Error('Duplicate endpoint');
      if (r.kind === 'disconnected' && r.pins.length !== 2) throw new Error('disconnected requires exactly two endpoints');
      if (r.exact !== undefined && typeof r.exact !== 'boolean') throw new Error('exact must be boolean');
    }
  }
  if (data.scope === 'complete') throw new Error('Interpreted targets currently support partial scope only; a complete native target is required to certify whole-schematic equality');
  return structuredClone(data);
}
export function compareContract(board, contract) {
  const refs = new Map(board.components.map(c => [c.ref, c]));
  const pins = new Map(); board.nets.forEach((net, i) => net.nodes.forEach(p => pins.set(pinKey(p), i)));
  const checks = contract.requirements.map(r => {
    if (!r.certain) return { ...r, status: 'unknown', detail: 'Source interpretation is uncertain' };
    let ok = false, detail;
    if (r.kind === 'component') {
      const c = refs.get(r.ref); ok = !!c && Object.entries(r.properties).every(([k, v]) => c[k] === v);
      detail = c ?? 'Missing component';
    } else if (r.kind === 'absent') ok = !refs.has(r.ref);
    else {
      const ns = r.pins.map(p => pins.get(pinKey(p)));
      if (ns.some(n => n === undefined)) return { ...r, status: 'unknown', detail: 'An endpoint is missing from the exported netlist; cannot prove connectivity/disconnection' };
      ok = r.kind === 'connected' ? ns.every(n => n === ns[0]) : ns[0] !== ns[1];
      if (ok && r.kind === 'connected' && r.exact) ok = JSON.stringify(sorted(board.nets[ns[0]].nodes.map(pinKey))) === JSON.stringify(sorted(r.pins.map(pinKey)));
      detail = ns.map(n => board.nets[n].name);
    }
    return { ...r, status: ok ? 'match' : 'difference', ...(detail === undefined ? {} : { actual: detail }) };
  });
  const matches = !contract.unresolved.length && checks.every(c => c.status === 'match');
  return { scope: 'declared_requirements_only', matches, wholeSchematicEquality: false, checks,
    differences: checks.filter(c => c.status !== 'match'), unresolved: contract.unresolved,
    notes: ['Only declared requirements are checked. Image/PDF/text interpretation is not an independent verification of the original source.'] };
}

export function objectInventory(source) {
  return schematic(source).children.filter(n => n.children).map(n => ({ kind: tag(n), uuid: value(n, 'uuid') ?? null, source: raw(source, n) }));
}

// Partial targets do not authorize unrelated electrical changes. Remove only
// explicitly addressed endpoints and compare the remaining net partitions.
export function unexpectedChanges(before, after, contract) {
  const issues = [], allowed = new Map(), removed = new Set(), touched = new Set();
  for (const r of contract.requirements.filter(r => r.certain)) {
    if (r.kind === 'component') {
      const fields = allowed.get(r.ref) ?? new Set();
      Object.keys(r.properties).forEach(k => fields.add(k)); allowed.set(r.ref, fields);
    } else if (r.kind === 'absent') removed.add(r.ref);
    else r.pins.forEach(p => touched.add(pinKey(p)));
  }
  const a = new Map(before.components.map(c => [c.ref, c])), b = new Map(after.components.map(c => [c.ref, c]));
  for (const [ref, old] of a) {
    const next = b.get(ref);
    if (!next) { if (!removed.has(ref)) issues.push({ kind: 'undeclared_removal', ref }); continue; }
    for (const field of ['value', 'footprint', 'libId', 'dnp', 'inBom', 'onBoard']) if (old[field] !== next[field] && !allowed.get(ref)?.has(field)) issues.push({ kind: 'undeclared_property', ref, field });
    for (const key of new Set([...Object.keys(old.properties ?? {}), ...Object.keys(next.properties ?? {})])) {
      const builtin = { Value: 'value', Footprint: 'footprint', dnp: 'dnp' }[key];
      if ((old.properties?.[key] ?? '') !== (next.properties?.[key] ?? '') && !(builtin && allowed.get(ref)?.has(builtin))) issues.push({ kind: 'undeclared_custom_property', ref, field: key });
    }
  }
  for (const ref of b.keys()) if (!a.has(ref) && !allowed.has(ref)) issues.push({ kind: 'undeclared_addition', ref });
  const newRefs = new Set([...b.keys()].filter(r => !a.has(r) && allowed.has(r)));
  const partition = board => sorted(board.nets.map(n => n.nodes.filter(p => !removed.has(p.ref) && !newRefs.has(p.ref) && !touched.has(pinKey(p))).map(pinKey).sort()).filter(p => p.length).map(p => JSON.stringify(p)));
  if (JSON.stringify(partition(before)) !== JSON.stringify(partition(after))) issues.push({ kind: 'undeclared_topology', detail: 'Pins not named in target connection requirements changed connectivity; specify all affected endpoints before applying.' });
  const signature = n => JSON.stringify(n.nodes.map(pinKey).sort());
  const actualNets = new Map(after.nets.map(n => [signature(n), n]));
  for (const n of before.nets) {
    const next = actualNets.get(signature(n));
    if (next && !autoName(n.name) && next.name !== n.name && !n.nodes.some(p => touched.has(pinKey(p)) || removed.has(p.ref))) issues.push({ kind: 'undeclared_net_name', actual: next.name, expected: n.name });
  }
  return issues;
}
