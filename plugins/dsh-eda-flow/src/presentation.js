import path from 'node:path';
import { readJSON, tree } from './io.js';
const tag = x => Array.isArray(x) ? x[0]?.atom || x[0] : null;
const child = (x, key) => x.find(v => tag(v) === key)?.slice(1) || [];
const props = x => Object.fromEntries(x.filter(v => tag(v) === 'property').map(v => [v[1], v[2]]));
export async function presentation(p) {
  const empty = { components: [], pins: [], nets: [], footprints: [], tracks: [], models: [], files: [], materials: { source_native: [] }, counts: {}, requirements: {}, defaults: p.inputs };
  if (p.mode === 'text-mcp') {
    const generated = p.stages.filter(s => s.status === 'done' && s.id >= 4 && s.output).at(-1);
    const analysisStage = p.stages.filter(s => s.status === 'done' && s.id < 4).at(-1);
    const analyses = analysisStage?.result;
    const actual = generated ? await readJSON(path.join(generated.output, 'generated-review.json')).catch(() => null) : null;
    const files = p.stages.filter(s => s.output && s.status !== 'running').flatMap(s => (s.files || []).map(f => ({ ...f, size: f.bytes, name: path.basename(f.path), scope: 'stage:' + s.id, stage: s.id })));
    const visible = actual ? {...actual,components:actual.components.map(c=>({...c,source:'实际 KiCad 回读'}))} : {components:(analyses?.components || []).map(c=>({...c,source:analysisStage?.id===3?'候选电路':'资料提取'}))};
    return { ...empty, ...visible, files, origin: 'text-mcp', scope: 'schematic', requirements: { text: p.inputs.requirements, datasheetText: p.inputs.datasheetText || '' },
      checks: generated?.result?.checks || [], provenance: actual ? (p.controlledLayout ? '来自冻结电路的受控编译及实际 KiCad 回读。' : '来自本次模型 MCP 工程的实际 KiCad 回读。') : '来自资料提取或候选电路，尚未生成有效原理图。', liveHarnessValidation: p.liveHarnessValidation || 'pending' };
  }
  if (!p.inputsBundle) {
    // A new design uses the same tables, populated only by supplied or extracted data.
    const extracted = p.stages[1]?.status === 'done' && p.stages[1].output;
    const components = extracted ? await readJSON(path.join(extracted, 'prepared/02_extracted/native_schematic/components.json')).catch(() => []) : [];
    const graph = extracted ? await readJSON(path.join(extracted, 'prepared/02_extracted/native_schematic/recomputed_connectivity.json')).catch(() => ({ pins: [], nets: [] })) : { pins: [], nets: [] };
    const latest = p.stages.filter(s => s.status === 'done').at(-1)?.result || {};
    return { ...empty, components: components.length ? components.map((c,id) => {
      const params = Object.fromEntries(c.parameters.map(x => [x.name,x.value]));
      return { id, ref: c.reference, value: params.Comment || '', code: params['物料编码'] || '', footprint: c.implementations.find(x => x.fields.ModelType === 'PCBLIB')?.fields.ModelName || '', parameters: params, source: c.source_locator, pins: c.pins.length };
    }) : (p.inputs.components || latest.components || []).map((r,id) => ({ id, ...r })),
      pins: graph.pins.map((r,id) => ({ id, ...r })), nets: graph.nets.map((r,id) => ({ id, name: r.labels.join(' / ') || `未命名网络 ${id+1}`, nodes: r.nodes.map(n => n.join('.')), nc: r.nc })),
      files: extracted ? (await tree(path.join(extracted,'prepared'))).map(f => ({ ...f, size: f.bytes, name: path.basename(f.path), scope: 'stage:2', path: 'prepared/' + f.path, stage: 2 })) : [],
    };
  }
  const read = name => readJSON(path.join(p.inputsBundle, name));
  const [components, connectivity, footprints, tracks, materials, requirements, files] = await Promise.all([
    read('03_components/components.json'), read('04_schematic/recomputed_connectivity.json'), read('05_footprints/instances.json'), read('06_pcb/tracks.json'), read('02_materials/materials.json'), read('01_task/requirements.json'), tree(p.inputsBundle)
  ]);
  const nets = connectivity.nets.map((n, id) => ({ id, name: n.labels.join(' / ') || `未命名网络 ${id + 1}`, nodes: n.nodes.map(v => v.join('.')), nc: n.nc }));
  const priority = ['U1', 'DISP', 'C2', 'C3', 'R1', 'D1'];
  const rows = components.map((c, id) => {
    const parameters = Object.fromEntries(c.parameters.map(p => [p.name, p.value]));
    const implementations = c.implementations.filter(i => i.fields.ModelType === 'PCBLIB');
    return { id, ref: c.reference, value: parameters.Comment || '', description: parameters['物料描述'] || '', code: parameters['物料编码'] || '', mount: parameters['装配类型'] || '', footprint: (implementations.find(i => i.fields.IsCurrent === 'T') || implementations[0])?.fields.ModelName || '', pins: c.pins.length, parameters, source: c.source_locator };
  }).sort((a,b) => (priority.includes(a.ref) ? priority.indexOf(a.ref) : 99) - (priority.includes(b.ref) ? priority.indexOf(b.ref) : 99));
  const fileRows = files.map(f => ({ ...f, name: path.basename(f.path), group: f.path.split('/')[0], size: f.bytes, hash: f.sha256 }));
  return { ...empty, components: rows, nets, pins: connectivity.pins.map((r, id) => ({ id, ref: r.ref, pin: r.pin, name: r.name, point: r.endpoint, net: nets.find(n => n.nodes.includes(`${r.ref}.${r.pin}`))?.name || '' })),
    footprints: footprints.map((f, id) => ({ id, ref: props(f.data).Reference || `辅助铜形 ${id + 1}`, value: props(f.data).Value || '', position: child(f.data, 'at'), layer: child(f.data, 'layer'), pads: f.data.filter(v => tag(v) === 'pad').map(v => ({ number: v[1], type: v[2]?.atom || v[2], size: child(v, 'size'), position: child(v, 'at'), layers: child(v, 'layers') })) })),
    tracks: tracks.map((r,id) => ({ id, kind: r.kind, layer: child(r.data, 'layer')[0], net: child(r.data, 'net')[0], width: child(r.data, 'width')[0], start: child(r.data, 'start'), end: child(r.data, 'end') })),
    materials, requirements, files: fileRows, models: fileRows.filter(f => /native_models\/.*\.(step|stp)$/i.test(f.path)),
    counts: { components: components.length, pins: connectivity.pins.length, nets: nets.length, footprints: footprints.length, tracks: tracks.length } };
}
