import fs from 'node:fs/promises';
import path from 'node:path';
import {readJSON, writeJSON} from './io.js';

// These are readability heuristics.  They deliberately do not depend on the
// selected paper size: changing A3 to A0 must not make the same geometry pass.
const LONG_SEGMENT_MM = 60;
const LONG_CLUSTER_MIN_COUNT = 3;
const LONG_CLUSTER_FRACTION = 0.25;
const ENVELOPE_AREA_MM2 = 10000;
const ENVELOPE_MIN_TRACKS = 2;
const DETOUR_REVIEW_RATIO = 2.5;

const pointKey = (x, y) => `${Number(x).toFixed(6)},${Number(y).toFixed(6)}`;
const pinReference = pin => {
  const index = String(pin).lastIndexOf('.');
  return index < 0 ? String(pin) : String(pin).slice(0, index);
};

function projectDirectory(project) {
  if (typeof project === 'string') return project;
  if (!project || typeof project !== 'object') return null;
  for (const key of ['project', 'path', 'directory', 'root', 'output']) {
    if (typeof project[key] === 'string') return project[key];
  }
  if (project.lastValidLayout && typeof project.lastValidLayout.project === 'string') return project.lastValidLayout.project;
  return null;
}

function wireSegments(source) {
  const result = [];
  // Capture all points in each native wire record, then split consecutive
  // points.  Current generated files use two points, but this also handles
  // future native multi-point wires without a CAD parser or KiCad CLI.
  const wirePattern = /\(wire\s+\(pts((?:\s+\(xy\s+[-0-9.]+\s+[-0-9.]+\))+?)\s*\)/g;
  const pointPattern = /\(xy\s+([-0-9.]+)\s+([-0-9.]+)\)/g;
  let wire;
  while ((wire = wirePattern.exec(source))) {
    const points = [];
    let point;
    while ((point = pointPattern.exec(wire[1]))) points.push([Number(point[1]), Number(point[2])]);
    for (let index = 1; index < points.length; index += 1) {
      const [x1, y1] = points[index - 1];
      const [x2, y2] = points[index];
      result.push({x1, y1, x2, y2, a: pointKey(x1, y1), b: pointKey(x2, y2), lengthMm: Math.hypot(x2 - x1, y2 - y1)});
    }
  }
  return result;
}

class UnionFind {
  constructor(items) { this.parent = new Map([...items].map(item => [item, item])); }
  find(item) {
    let root = this.parent.get(item);
    if (root === undefined) return undefined;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cursor = item;
    while (this.parent.get(cursor) !== cursor) {
      const next = this.parent.get(cursor);
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }
  union(left, right) {
    const a = this.find(left), b = this.find(right);
    if (a !== undefined && b !== undefined && a !== b) this.parent.set(b, a);
  }
}

function wireGraph(edges, pins) {
  const vertices = new Set(edges.flatMap(edge => [edge.a, edge.b]));
  const union = new UnionFind(vertices);
  edges.forEach(edge => union.union(edge.a, edge.b));
  const components = new Map();
  edges.forEach(edge => {
    const root = union.find(edge.a);
    if (!components.has(root)) components.set(root, {edges: [], vertices: new Set()});
    const component = components.get(root);
    component.edges.push(edge);
    component.vertices.add(edge.a);
    component.vertices.add(edge.b);
  });
  const pinsAt = new Map();
  for (const [pin, point] of Object.entries(pins || {})) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const key = pointKey(point[0], point[1]);
    if (!pinsAt.has(key)) pinsAt.set(key, []);
    pinsAt.get(key).push(pin);
  }
  for (const component of components.values()) {
    component.pins = [...new Set([...component.vertices].flatMap(vertex => pinsAt.get(vertex) || []))].sort();
    component.lengthMm = component.edges.reduce((sum, edge) => sum + edge.lengthMm, 0);
    component.cycleRank = component.edges.length - component.vertices.size + 1;
    const coordinates = [...component.vertices].map(value => value.split(',').map(Number));
    component.minX = Math.min(...coordinates.map(point => point[0]));
    component.maxX = Math.max(...coordinates.map(point => point[0]));
    component.minY = Math.min(...coordinates.map(point => point[1]));
    component.maxY = Math.max(...coordinates.map(point => point[1]));
    component.bboxAreaMm2 = (component.maxX - component.minX) * (component.maxY - component.minY);
  }
  return [...components.values()];
}

function manhattan(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }

function mstManhattan(points) {
  if (points.length < 2) return 0;
  const joined = new Set([0]);
  const nearest = points.map((_, index) => index === 0 ? 0 : Infinity);
  let total = 0;
  while (joined.size < points.length) {
    let candidate = -1, distance = Infinity;
    for (let index = 0; index < points.length; index += 1) {
      if (joined.has(index)) continue;
      let nearestDistance = nearest[index];
      for (const existing of joined) nearestDistance = Math.min(nearestDistance, manhattan(points[index], points[existing]));
      nearest[index] = nearestDistance;
      if (nearestDistance < distance) { distance = nearestDistance; candidate = index; }
    }
    if (candidate < 0 || !Number.isFinite(distance)) break;
    joined.add(candidate);
    total += distance;
  }
  return total;
}

function layoutGroups(layout, audit) {
  if (Array.isArray(layout?.groups)) return layout.groups;
  if (Array.isArray(layout?.effectiveLayout?.groups)) return layout.effectiveLayout.groups;
  if (Array.isArray(audit?.effectiveLayout?.groups)) return audit.effectiveLayout.groups;
  return [];
}

function groupMetrics(readback, groups, graphComponents) {
  const byRef = new Map((readback.components || []).map(component => [component.reference, component]));
  const groupByRef = new Map();
  groups.forEach(group => (group.references || []).forEach(reference => groupByRef.set(reference, group.id)));
  for (const component of graphComponents) component.groups = [...new Set(component.pins.map(pin => groupByRef.get(pinReference(pin)) || 'unassigned'))];
  const wireByGroup = new Map();
  const ensure = id => {
    if (!wireByGroup.has(id)) wireByGroup.set(id, {wireLengthMm: 0, longWireLengthMm: 0, longWireCount: 0});
    return wireByGroup.get(id);
  };
  for (const component of graphComponents) {
    for (const group of component.groups) {
      const row = ensure(group);
      row.wireLengthMm += component.lengthMm;
      for (const edge of component.edges) {
        if (edge.lengthMm >= LONG_SEGMENT_MM) {
          row.longWireLengthMm += edge.lengthMm;
          row.longWireCount += 1;
        }
      }
    }
  }
  return groups.map(group => {
    const members = (group.references || []).map(reference => byRef.get(reference)).filter(Boolean);
    const xs = members.map(component => Number(component.at?.[0])).filter(Number.isFinite);
    const ys = members.map(component => Number(component.at?.[1])).filter(Number.isFinite);
    const wire = wireByGroup.get(group.id) || {wireLengthMm: 0, longWireLengthMm: 0, longWireCount: 0};
    return {
      id: group.id,
      title: group.title,
      references: group.references || [],
      componentCount: members.length,
      componentBBoxAreaMm2: xs.length ? (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) : 0,
      componentDiagonalMm: xs.length ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) : 0,
      wireLengthMm: Number(wire.wireLengthMm.toFixed(3)),
      longWireLengthMm: Number(wire.longWireLengthMm.toFixed(3)),
      longWireCount: wire.longWireCount,
    };
  });
}

function railEnvelopes(longSegments) {
  const horizontal = longSegments.filter(edge => Math.abs(edge.y1 - edge.y2) < 1e-6);
  const vertical = longSegments.filter(edge => Math.abs(edge.x1 - edge.x2) < 1e-6);
  if (horizontal.length < ENVELOPE_MIN_TRACKS || vertical.length < ENVELOPE_MIN_TRACKS) return [];
  const all = [...horizontal, ...vertical];
  const xs = all.flatMap(edge => [edge.x1, edge.x2]);
  const ys = all.flatMap(edge => [edge.y1, edge.y2]);
  const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  if (area < ENVELOPE_AREA_MM2) return [];
  return [{
    horizontalTrackCount: horizontal.length,
    verticalTrackCount: vertical.length,
    bboxMm: {minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys)},
    bboxAreaMm2: Number(area.toFixed(3)),
    longWireLengthMm: Number(all.reduce((sum, edge) => sum + edge.lengthMm, 0).toFixed(3)),
  }];
}

function baseResult() {
  return {
    schema: 'routing-quality.v1',
    status: 'failed',
    metrics: null,
    findings: [],
    limitations: [
      '这是可读性启发式门槛；status=passed 不证明与 AD 原理图视觉一致。',
      '几何 wire graph 只描述图面线段，不证明 KiCad 网表、电气连接或 ERC 正确。',
      `长线阈值固定为 ${LONG_SEGMENT_MM} mm，长线簇还要求至少 ${LONG_CLUSTER_MIN_COUNT} 段且占总线长 ${LONG_CLUSTER_FRACTION * 100}%；更换纸张不会改变门槛。`,
    ],
  };
}

function finding(code, severity, message, details = undefined) {
  return details === undefined ? {code, severity, message} : {code, severity, message, details};
}

/**
 * Review generated schematic routing without changing the design.
 * `project` may be a project directory or an object containing one of
 * project/path/directory/root/output (or lastValidLayout.project).
 */
export async function reviewRoutingQuality({project, audit, layout} = {}) {
  const result = baseResult();
  const root = projectDirectory(project);
  try {
    if (!root || typeof audit !== 'object' || audit === null || typeof layout !== 'object' || layout === null) {
      result.findings.push(finding('INPUT_INVALID', 'error', 'project、audit、layout 必须提供且格式正确。'));
      return result;
    }
    const schematicFile = project.schematicPath || path.join(root, 'Circuit.kicad_sch');
    const readbackFile = project.readbackPath || path.join(root, 'readback.json');
    const [source, readback] = await Promise.all([fs.readFile(schematicFile, 'utf8'), readJSON(readbackFile)]);
    if (!source.includes('(kicad_sch')) throw new Error('Circuit.kicad_sch 不是可识别的 KiCad 原理图文本。');
    if (!readback || typeof readback !== 'object' || !readback.pins || !Array.isArray(readback.nets) || !Array.isArray(readback.components)) {
      throw new Error('readback.json 缺少 pins、nets 或 components。');
    }

    const edges = wireSegments(source);
    const graph = wireGraph(edges, readback.pins);
    const groups = layoutGroups(layout, audit);
    const groupByRef = new Map(groups.flatMap(group => (group.references || []).map(reference => [reference, group.id])));
    const netDetails = readback.nets.map(net => {
      const nodes = Array.isArray(net.nodes) ? net.nodes : [];
      const hits = graph.filter(component => component.pins.some(pin => nodes.includes(pin)));
      const connected = hits.length === 1 && nodes.every(node => hits[0].pins.includes(node));
      const points = nodes.map(node => readback.pins[node]).filter(point => Array.isArray(point) && point.length >= 2).map(point => [Number(point[0]), Number(point[1])]);
      const lowerBoundMm = mstManhattan(points);
      const wireLengthMm = hits.reduce((sum, component) => sum + component.lengthMm, 0);
      return {
        name: net.name,
        nodeCount: nodes.length,
        groups: [...new Set(nodes.map(node => groupByRef.get(pinReference(node)) || 'unassigned'))],
        wireLengthMm: Number(wireLengthMm.toFixed(3)),
        lowerBoundMm: Number(lowerBoundMm.toFixed(3)),
        detourRatio: connected && lowerBoundMm > 0 ? Number((wireLengthMm / lowerBoundMm).toFixed(3)) : null,
        connected,
      };
    });
    const totalWireMm = edges.reduce((sum, edge) => sum + edge.lengthMm, 0);
    const longSegments = edges.filter(edge => edge.lengthMm >= LONG_SEGMENT_MM);
    const longWireLengthMm = longSegments.reduce((sum, edge) => sum + edge.lengthMm, 0);
    const detours = netDetails.map(net => net.detourRatio).filter(Number.isFinite).sort((a, b) => a - b);
    const detourP95 = detours.length ? detours[Math.min(detours.length - 1, Math.floor(detours.length * 0.95))] : null;
    const envelopes = railEnvelopes(longSegments);
    const noWires = edges.length === 0;
    const multiNodeNets = readback.nets.filter(net => Array.isArray(net.nodes) && net.nodes.length > 1);
    const allNc = noWires && Object.keys(readback.pins).length > 0 && multiNodeNets.length === 0 && Object.keys(readback.pins).every(pin => (readback.nc || []).includes(pin));
    const groupRows = groupMetrics(readback, groups, graph);
    const page = audit.layout?.pageMm || audit.pageMm || null;
    result.metrics = {
      constants: {longSegmentMm: LONG_SEGMENT_MM, longClusterMinCount: LONG_CLUSTER_MIN_COUNT, longClusterFraction: LONG_CLUSTER_FRACTION, envelopeAreaMm2: ENVELOPE_AREA_MM2},
      pageMm: Array.isArray(page) ? page : null,
      wire: {
        segmentCount: edges.length,
        totalWireMm: Number(totalWireMm.toFixed(3)),
        maxSegmentMm: Number((Math.max(0, ...edges.map(edge => edge.lengthMm))).toFixed(3)),
        longSegmentCount: longSegments.length,
        longWireLengthMm: Number(longWireLengthMm.toFixed(3)),
        longWireFraction: totalWireMm ? Number((longWireLengthMm / totalWireMm).toFixed(4)) : 0,
      },
      nets: {
        count: netDetails.length,
        disconnectedCount: netDetails.filter(net => !net.connected).length,
        crossGroupCount: netDetails.filter(net => net.groups.length > 1).length,
        detourP95,
        details: netDetails,
      },
      groups: groupRows,
      graph: {
        connectedWireComponents: graph.length,
        withPins: graph.filter(component => component.pins.length).length,
        cycleCount: graph.filter(component => component.cycleRank > 0).length,
        railEnvelopeCandidates: envelopes,
      },
    };

    if (noWires) {
      if (allNc) {
        result.findings.push(finding('NO_WIRES_ALL_NC', 'info', '原理图没有 wire，且所有引脚均为 NC；未将其伪报为绕线错误。'));
      } else if (multiNodeNets.length) {
        result.findings.push(finding('NO_WIRES_WITH_NETS', 'error', '原理图没有 wire，但 readback 包含多引脚网络；无法通过几何检查确认连接。'));
      }
    }
    if (longSegments.length) {
      const cluster = longSegments.length >= LONG_CLUSTER_MIN_COUNT && (longWireLengthMm / Math.max(totalWireMm, 1)) >= LONG_CLUSTER_FRACTION;
      result.findings.push(finding(cluster ? 'LONG_WIRE_CLUSTER' : 'LONG_WIRE_REVIEW', cluster ? 'error' : 'info', `${longSegments.length} 条线段达到 ${LONG_SEGMENT_MM} mm 固定可读性审查阈值。`, {longWireFraction: Number((longWireLengthMm / Math.max(totalWireMm, 1)).toFixed(4))}));
    }
    if (envelopes.length) result.findings.push(finding('PARALLEL_TRACK_ENVELOPE', 'error', '多条平行长线共同包络大片空白区域，需检查是否应使用功能分组、局部线段或网络标签。', envelopes));
    if (detourP95 !== null && detourP95 > DETOUR_REVIEW_RATIO) result.findings.push(finding('HIGH_DETOUR_REVIEW', 'warning', `已连接网络的 P95 绕行比为 ${detourP95}，超过 ${DETOUR_REVIEW_RATIO} 的人工审查提示值。`));

    const hardFailures = result.findings.some(item => item.severity === 'error');
    result.status = hardFailures ? 'failed' : 'passed';
  } catch (error) {
    result.findings.push(finding('INPUT_INVALID', 'error', `routing quality 输入读取或解析失败：${error.message}`));
  }
  if (root) {
    try { await writeJSON(path.join(root, 'routing-quality.json'), result); }
    catch (error) { result.findings.push(finding('REPORT_WRITE_FAILED', 'error', `无法写入 routing-quality.json：${error.message}`)); result.status = 'failed'; }
  }
  return result;
}

export const routingQualityThresholds = Object.freeze({
  longSegmentMm: LONG_SEGMENT_MM,
  longClusterMinCount: LONG_CLUSTER_MIN_COUNT,
  longClusterFraction: LONG_CLUSTER_FRACTION,
  envelopeAreaMm2: ENVELOPE_AREA_MM2,
  detourReviewRatio: DETOUR_REVIEW_RATIO,
});

