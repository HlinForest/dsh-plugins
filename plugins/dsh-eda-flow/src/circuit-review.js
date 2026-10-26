/**
 * Static review for passive component intent and load-current control.
 *
 * This module deliberately reviews a small, generic contract.  It does not
 * know any project reference design, preferred resistor value, pin table, or
 * schematic coordinate.  A caller may use it before a complete pin-level
 * design exists; the result then remains a draft until the missing evidence
 * or design choices are supplied.
 */

import {reviewPeripherals} from './peripheral-review.js';
export const ELECTRICAL_ROLES = Object.freeze([
  'routing-bridge',
  'current-limit',
  'series-damping',
  'pull-up',
  'pull-down',
  'supply-filter',
  'decoupling',
  'interface-filter',
  'other',
]);

const LOAD_KINDS = new Set(['display', 'led', 'indicator', 'display-module', 'segment-display', 'seven-segment']);
const LOAD_KIND_RE = /(display|led|indicator|segment)/i;
const LOAD_SYMBOL_RE = /(display|led|indicator|segment|7seg|seven.?seg)/i;
const ROLE_SET = new Set(ELECTRICAL_ROLES);
const CURRENT_CONTROLS = new Set(['resistor', 'regulated', 'unresolved']);
const POSITIVE_RESISTOR_ROLES = new Set(['series-damping', 'pull-up', 'pull-down']);

const issue = (code, message, fields = {}) => ({ code, message, ...fields });

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function key(value) {
  return text(value).toLowerCase();
}

function numericResistance(value) {
  const raw = text(value).replace(/[\u03a9\u2126]/g, 'ohm').replace(/\s+/g, '');
  if (!raw || /^(?:unknown|unk|n\/a|na|tbd|to[-_ ]?be[-_ ]?determined|\?|-)$/i.test(raw)) return null;
  const match = raw.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([kKmMgGtTuUµunp]?)(?:[rR]|[oO][hH][mM])?$/);
  if (!match) return null;
  const multiplier = {
    '': 1,
    k: 1e3, K: 1e3,
    m: 1e-3, M: 1e6,
    g: 1e9, G: 1e9,
    t: 1e12, T: 1e12,
    u: 1e-6,
    U: 1e-6,
    'µ': 1e-6,
    n: 1e-9,
    p: 1e-12,
  }[match[2]];
  if (multiplier === undefined) return null;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? parsed : null;
}

function componentEvidenceRows(evidence) {
  if (!evidence) return [];
  if (Array.isArray(evidence)) return evidence.filter(row => row && typeof row === 'object');
  const rows = evidence.components ?? evidence.componentEvidence ?? evidence.parts
    ?? (evidence.componentKind || evidence.sourceSymbol || evidence.source || evidence.symbol ? [evidence] : []);
  if (Array.isArray(rows)) return rows.filter(row => row && typeof row === 'object');
  if (rows && typeof rows === 'object') {
    return Object.entries(rows).map(([ref, row]) => ({ ...(row || {}), ref: row?.ref || ref }));
  }
  return [];
}

function sourceSymbol(row) {
  return text(
    row?.sourceSymbol
      ?? row?.symbolId
      ?? row?.source?.symbol
      ?? row?.source?.librarySymbol
      ?? row?.librarySymbol
      ?? row?.symbol,
  );
}

function componentKind(row) {
  return text(row?.componentKind ?? row?.kind ?? row?.type ?? row?.source?.componentKind);
}

function componentSymbol(component) {
  return text(component?.librarySymbol ?? component?.sourceSymbol ?? component?.symbol ?? component?.symbolId);
}

function isResistorComponent(component) {
  const symbol = componentSymbol(component);
  if (/(?:^|:)r(?:$|[_\-\s])|resistor/i.test(symbol)) return true;
  if (!symbol && /^r/i.test(text(component?.ref))) return true;
  return key(component?.kind) === 'resistor' || key(component?.componentKind) === 'resistor';
}

function isPowerNet(netName) {
  return /^(?:\+?(?:vcc|vdd|vss|vee|vin|vout|5v|3v3|12v)|gnd|sgnd|ground|power|supply)(?:$|[_\-])/i.test(text(netName));
}

function isPowerPin(pin, netName) {
  return /^(?:power|gnd|vcc|vdd|vss|vee|supply)/i.test(text(pin?.type))
    || /^(?:gnd|sgnd|vcc|vdd|vss|vee|\+?\d+(?:\.\d+)?v|power|supply)/i.test(text(pin?.name))
    || isPowerNet(netName);
}

function contextRows(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(row => row && typeof row === 'object');
  if (typeof value === 'object') {
    if (Array.isArray(value.evidence)) return contextRows(value.evidence);
    if (Array.isArray(value.guidance)) return contextRows(value.guidance);
    if (value.id || value.guidanceId || value.sourceId || value.content || value.text || value.quote) return [value];
    return Object.entries(value).map(([id, row]) => ({ ...(row && typeof row === 'object' ? row : { content: row }), id: row?.id || id }));
  }
  return [];
}

function sourceRowContent(row) {
  return [row?.content, row?.text, row?.quote, row?.excerpt, row?.description]
    .map(text)
    .filter(Boolean)
    .join('\n');
}

function inputSourceRows(inputs) {
  if (Array.isArray(inputs)) return contextRows(inputs);
  if (!inputs || typeof inputs !== 'object') return [];
  if (Array.isArray(inputs.evidence)) return contextRows(inputs.evidence);
  // Do not let an inputs.guidance convenience field become a source.  A
  // direct source-shaped input object is still accepted for callers that pass
  // one record instead of { evidence: [...] }.
  if (inputs.guidance !== undefined) {
    const direct = {
      id: inputs.id,
      sourceId: inputs.sourceId,
      content: inputs.content,
      text: inputs.text,
      quote: inputs.quote,
      excerpt: inputs.excerpt,
      description: inputs.description,
    };
    return sourceRowContent(direct) ? [direct] : [];
  }
  return contextRows(inputs);
}

function citationContext({ evidence, inputs, guidance }) {
  // Only evidence/input source rows establish the text that can be cited.
  // Guidance prose is authored by the workflow and must not become a source
  // merely because it repeats a claim such as "恒流".
  const sourceRows = [
    ...contextRows(evidence),
    ...inputSourceRows(inputs),
  ];
  const sourceById = new Map();
  for (const row of sourceRows) {
    const ids = [row?.id, row?.guidanceId, row?.sourceId, row?.attachmentId].map(text).filter(Boolean);
    const content = sourceRowContent(row);
    for (const id of ids) sourceById.set(id, content);
  }

  const byId = new Map(sourceById);
  for (const row of contextRows(guidance)) {
    const validQuotes = asArray(row?.citations)
      .map(citation => ({
        sourceId: text(citation?.sourceId),
        quote: text(citation?.quote),
      }))
      .filter(citation => {
        const source = sourceById.get(citation.sourceId);
        return Boolean(source && citation.quote && normalizedContains(source, citation.quote));
      })
      .map(citation => citation.quote);
    const ids = [row?.id, row?.guidanceId].map(text).filter(Boolean);
    // A guidance id is usable only through quotes that were found verbatim in
    // the current evidence/input source.  Never include statement/description
    // here: those fields are workflow assertions, not source material.
    if (validQuotes.length) {
      for (const id of ids) byId.set(id, validQuotes.join('\n'));
    }
  }
  return byId;
}

function normalizedContains(content, quote) {
  const normalize = value => text(value).replace(/\s+/g, ' ').toLowerCase();
  const haystack = normalize(content);
  const needle = normalize(quote);
  return Boolean(needle && haystack.includes(needle));
}

function citationMatches(basis, context) {
  if (typeof basis === 'string') return Boolean(text(context.get(text(basis))));
  if (!basis || typeof basis !== 'object') return false;
  const guidanceId = text(basis.guidanceId);
  if (guidanceId) {
    const content = context.get(guidanceId);
    return Boolean(text(content)) && (!basis.quote || normalizedContains(content, basis.quote));
  }
  const sourceId = text(basis.sourceId);
  const quote = text(basis.quote);
  if (!sourceId || !quote) return false;
  const content = context.get(sourceId);
  return Boolean(text(content)) && normalizedContains(content, quote);
}

function isLoadEvidence(row) {
  const kind = componentKind(row);
  const symbol = sourceSymbol(row);
  // A fact row's symbolId can intentionally be an opaque evidence handle
  // (for example Evidence:Fact_<hash>), so componentKind is the authoritative
  // classification.  A symbol-only row is accepted only when its source
  // symbol itself carries a display/LED semantic.
  return LOAD_KINDS.has(key(kind)) || LOAD_KIND_RE.test(kind) || (!kind && LOAD_SYMBOL_RE.test(symbol));
}

function isLoadComponent(component) {
  const kind = componentKind(component);
  const symbol = componentSymbol(component);
  return LOAD_KINDS.has(key(kind)) || LOAD_KIND_RE.test(kind) || (!kind && LOAD_SYMBOL_RE.test(symbol));
}

function referencesForEvidence(row) {
  return [row?.ref, row?.reference, row?.designRef, row?.componentRef, row?.id].map(text).filter(Boolean);
}

function matchLoadComponents(designComponents, evidence) {
  const rows = componentEvidenceRows(evidence).filter(isLoadEvidence);
  const result = [];
  const used = new Set();
  for (const row of rows) {
    const refs = new Set(referencesForEvidence(row).map(key));
    let component = designComponents.find(c => refs.has(key(c?.ref)) || refs.has(key(c?.id)));
    if (!component) {
      const symbol = key(sourceSymbol(row));
      if (symbol) {
        component = designComponents.find(c => !used.has(c) && [c?.librarySymbol, c?.sourceSymbol, c?.symbolId].some(value => symbol === key(value)));
      }
    }
    if (!component || used.has(component)) continue;
    used.add(component);
    result.push({ component, evidence: row });
  }
  // Evidence is preferred, but a library symbol or explicit componentKind is
  // itself sufficient to require a load assessment.  This keeps Device:LED
  // and Display:LED from bypassing the review when no evidence row was passed.
  for (const component of designComponents) {
    if (used.has(component) || !isLoadComponent(component)) continue;
    used.add(component);
    result.push({ component, evidence: null });
  }
  return result;
}

function buildConnectivity(design, components) {
  const netsByNode = new Map();
  const refsByNet = new Map();
  const componentByRef = new Map();
  for (const component of components) {
    if (component?.ref) componentByRef.set(component.ref, component);
  }
  for (const net of asArray(design?.nets)) {
    const netName = text(net?.name);
    if (!netName) continue;
    for (const node of asArray(net?.nodes)) {
      const nodeText = text(node);
      if (!nodeText) continue;
      if (!netsByNode.has(nodeText)) netsByNode.set(nodeText, new Set());
      netsByNode.get(nodeText).add(netName);
      const dot = nodeText.lastIndexOf('.');
      const ref = dot > 0 ? nodeText.slice(0, dot) : '';
      if (!ref || !componentByRef.has(ref)) continue;
      if (!refsByNet.has(netName)) refsByNet.set(netName, new Set());
      refsByNet.get(netName).add(ref);
    }
  }
  const netsByRef = new Map();
  const netsByPin = new Map();
  for (const component of components) {
    const ref = component?.ref;
    if (!ref) continue;
    const nets = new Set();
    for (const pin of asArray(component.pins)) {
      const nodeNets = new Set(netsByNode.get(`${ref}.${text(pin?.number || pin?.pad)}`) || []);
      netsByPin.set(`${ref}.${text(pin?.number || pin?.pad)}`, nodeNets);
      for (const netName of nodeNets) nets.add(netName);
    }
    netsByRef.set(ref, nets);
  }
  return { netsByNode, netsByRef, netsByPin, refsByNet };
}

function explicitPurpose(component) {
  const role = text(component?.electricalRole);
  if (role && role !== 'other') return true;
  return Boolean(text(component?.purpose ?? component?.roleDescription ?? component?.electricalPurpose));
}

function normalizedAssessment(assessment) {
  return {
    ref: text(assessment?.ref ?? assessment?.reference),
    currentControl: text(assessment?.currentControl),
    components: asArray(assessment?.components).map(text).filter(Boolean),
    channels: asArray(assessment?.channels).filter(channel => channel && typeof channel === 'object').map(channel => ({
      pin: text(channel.pin ?? channel.endpoint ?? channel.name),
      purpose: text(channel.purpose ?? channel.role),
    })).filter(channel => channel.pin),
    path: asArray(assessment?.path ?? assessment?.pathRefs ?? assessment?.seriesPath).map(text).filter(Boolean),
    driverRefs: asArray(assessment?.driverRefs ?? assessment?.drivers).map(text).filter(Boolean),
    basis: assessment?.basis ?? '',
    unresolved: asArray(assessment?.unresolved).map(text).filter(Boolean),
  };
}

function channelFromPin(pin) {
  const name = text(pin?.name);
  if (/^(?:A|B|C|D|E|F|G|DP|DECIMAL[_ ]?POINT)$/i.test(name)) return { pin: name, purpose: 'segment/anode', inferred: true };
  return null;
}

function loadChannelPlan(load, evidenceRow, assessment) {
  const explicit = assessment.channels;
  const evidenceChannels = asArray(evidenceRow?.channels ?? evidenceRow?.pinRoles)
    .filter(channel => channel && typeof channel === 'object')
    .map(channel => ({ pin: text(channel.pin ?? channel.endpoint ?? channel.name), purpose: text(channel.purpose ?? channel.role), inferred: false }))
    .filter(channel => channel.pin);
  const named = asArray(load?.pins).map(channelFromPin).filter(Boolean);
  const inferred = named.length
    ? named
    : (() => {
      const names = asArray(load?.pins).map(pin => key(pin?.name));
      if (names.includes('a') && (names.includes('k') || names.includes('cathode'))) return [{ pin: 'A', purpose: 'anode', inferred: true }];
      return [];
    })();
  const channels = explicit.length ? explicit : (evidenceChannels.length ? evidenceChannels : inferred);
  if (!channels.length) return { channels: [], ambiguous: true };
  const byKey = new Map(channels.map(channel => [key(channel.pin), channel]));
  // A display with named A-G pins defines the expected channel set even if a
  // partial assessment only listed one channel.  This prevents a direct wire
  // on an uncovered channel from being silently accepted.
  for (const channel of inferred) if (!byKey.has(key(channel.pin))) byKey.set(key(channel.pin), channel);
  return { channels: [...byKey.values()], ambiguous: false };
}

function findLoadPin(load, channel) {
  const wanted = key(channel?.pin);
  return asArray(load?.pins).find(pin => key(pin?.name) === wanted || key(pin?.number) === wanted || key(pin?.pad) === wanted);
}

function hasOutputPinOnNet(component, netName, netsByPin) {
  return asArray(component?.pins).some(pin => {
    const pinNets = netsByPin.get(`${text(component?.ref)}.${text(pin?.number || pin?.pad)}`) || new Set();
    return pinNets.has(netName) && /^(?:output|bidirectional|power_out|open_collector|open_emitter|tri_state)/i.test(text(pin?.type));
  });
}

function uncontrolledChannelDriver({ load, channelPin, netsByPin, netsByRef, refsByNet, componentByRef }) {
  const pending = [...(netsByPin.get(`${load.ref}.${text(channelPin.number || channelPin.pad)}`) || [])];
  const visited = new Set();
  while (pending.length) {
    const net = pending.pop();
    if (visited.has(net)) continue;
    visited.add(net);
    for (const ref of refsByNet.get(net) || []) {
      if (ref === load.ref) continue;
      const component = componentByRef.get(ref);
      if (hasOutputPinOnNet(component, net, netsByPin)) return ref;
      // Only actual zero-ohm two-terminal parts are transparent. Positive
      // resistors, capacitors and unknown values cannot prove a direct path.
      if (isResistorComponent(component) && numericResistance(component.value) === 0 && asArray(component.pins).length === 2) {
        pending.push(...(netsByRef.get(ref) || []));
      }
    }
  }
  return null;
}

function currentLimiterPathIsExplicitAndDirect({ selected, load, channelPin, assessment, netsByRef, netsByPin, refsByNet, componentByRef }) {
  const selectedRef = text(selected?.ref);
  const loadRef = text(load?.ref);
  const selectedNets = [...(netsByRef.get(selectedRef) || [])];
  if (selectedNets.length < 2) return false;

  const loadSideNets = new Set();
  const pins = channelPin ? [channelPin] : asArray(load?.pins);
  for (const pin of pins) {
    const pinNets = netsByPin.get(`${loadRef}.${text(pin?.number || pin?.pad)}`) || new Set();
    for (const netName of pinNets) if (!isPowerPin(pin, netName)) loadSideNets.add(netName);
  }
  const directLoadNets = selectedNets.filter(netName => loadSideNets.has(netName));
  const driverSideNets = selectedNets.filter(netName => !loadSideNets.has(netName));
  if (!directLoadNets.length || !driverSideNets.length) return false;

  const declaredPath = new Set([...(assessment.path || []), ...(assessment.driverRefs || [])]);
  for (const netName of driverSideNets) {
    for (const ref of refsByNet.get(netName) || []) {
      if (ref === selectedRef || ref === loadRef) continue;
      if (declaredPath.has(ref)) return true;
      const other = componentByRef.get(ref);
      if (!other) continue;
      if (hasOutputPinOnNet(other, netName, netsByPin)) return true;
      // A non-passive source/driver can be identified by its symbol and need
      // not have complete pin typing yet.  Power-only nets remain excluded.
      if (!isPowerNet(netName) && !isResistorComponent(other) && !/(?:^|:)c(?:$|[_\-\s])|capacitor/i.test(componentSymbol(other))) return true;
    }
  }
  return false;
}

function citationContent(basis, context) {
  if (typeof basis === 'string') return context.get(text(basis));
  if (!basis || typeof basis !== 'object') return undefined;
  const id = text(basis.guidanceId || basis.sourceId);
  return id ? context.get(id) : undefined;
}

function statesConstantCurrent(content) {
  const normalized = text(content).toLowerCase();
  const negative = /(?:not|no|without|non[\s-]*)\s*(?:constant[\s-]+current|current[\s-]+regulat(?:e|ed|es|ion))|(?:constant[\s-]+current|current[\s-]+regulat(?:e|ed|es|ion))[^.!?;\n]{0,48}\b(?:not|isn't|absent|unsupported|not\s+part|not\s+provided|not\s+specified)\b|(?:非|不具备|不含|不是|无|未提供|不支持)\s*(?:恒流|恒定电流)|(?:恒流|恒定电流)[^。；;，,\n]{0,20}(?:未提供|不具备|不支持|不存在|不是|无)/i.test(normalized);
  if (negative) return false;
  const constant = /恒流|恒定电流|constant[\s-]+current|current[\s-]+regulat(?:e|ed|es|ion)/i.test(normalized);
  const onlyLimit = /最大(?:输出)?电流|最大电流|max(?:imum)?[\s-]+(?:output[\s-]+)?current|current[\s-]+rating|io[12]\s*=/i.test(normalized);
  return constant && !onlyLimit;
}

function regulatedSourceMatches(basis, context) {
  const content = citationContent(basis, context);
  if (content === undefined || !text(content)) return false;
  const quote = typeof basis === 'object' ? text(basis.quote) : '';
  if (quote && !normalizedContains(content, quote)) return false;
  // When a quote is supplied, evaluate that exact quote.  Looking at the
  // rest of the page could let an unrelated constant-current sentence bless
  // a placement note or another component's specification.
  if (!statesConstantCurrent(quote || content)) return false;
  if (typeof basis === 'object' && text(basis.sourceId) && !text(basis.quote)) return false;
  return true;
}

function driverConnectedToLoad({ driverRef, loadRef, assessment, netsByRef, refsByNet }) {
  const driverNets = netsByRef.get(driverRef) || new Set();
  const loadNets = netsByRef.get(loadRef) || new Set();
  if ([...driverNets].some(netName => loadNets.has(netName))) return true;
  const bridgeRefs = [...(assessment.components || []), ...(assessment.path || [])];
  for (const bridgeRef of bridgeRefs) {
    const bridgeNets = netsByRef.get(bridgeRef) || new Set();
    const driverAttached = [...driverNets].some(netName => bridgeNets.has(netName));
    const loadAttached = [...loadNets].some(netName => bridgeNets.has(netName));
    if (driverAttached && loadAttached) return true;
  }
  // A declared driver must at least appear on one net containing the load or
  // an explicitly named bridge; sharing a global power net alone is not enough.
  return [...driverNets].some(netName => !isPowerNet(netName) && (refsByNet.get(netName) || new Set()).has(loadRef));
}

function driverConnectedToChannel({ driverRef, loadRef, channelPin, assessment, netsByRef, netsByPin }) {
  const driverNets = netsByRef.get(driverRef) || new Set();
  const channelNets = netsByPin.get(`${loadRef}.${text(channelPin?.number || channelPin?.pad)}`) || new Set();
  if ([...driverNets].some(netName => channelNets.has(netName))) return true;
  const bridgeRefs = [...(assessment.components || []), ...(assessment.path || [])];
  for (const bridgeRef of bridgeRefs) {
    const bridgeNets = netsByRef.get(bridgeRef) || new Set();
    const driverAttached = [...driverNets].some(netName => bridgeNets.has(netName));
    const channelAttached = [...channelNets].some(netName => bridgeNets.has(netName));
    if (driverAttached && channelAttached) return true;
  }
  // Do not fall back to another load pin's signal net: a regulated driver
  // must be proven on this exact channel (directly or through the declared
  // bridge path).  Shared ground/power and a different channel are not
  // evidence for the requested channel.
  return false;
}

/**
 * Review passive roles and load-current control.
 *
 * @param {object} design A partial or complete generic design object.
 * @param {object} [options]
 * @param {object} [options.evidence] Component evidence; display/LED loads
 * are found through componentKind and source symbol, never by reference name.
 * @returns {{errors: object[], warnings: object[], unresolved: string[], passiveRoles: object[], loadAssessments: object[], readiness: object}}
 */
export function reviewCircuit(design = {}, { evidence = {}, inputs = {}, requirements = [], guidance = {} } = {}) {
  const errors = [];
  const warnings = [];
  const unresolved = [];
  const components = asArray(design.components).filter(component => component && typeof component === 'object');
  const componentByRef = new Map(components.filter(component => text(component.ref)).map(component => [component.ref, component]));
  const { netsByRef, netsByPin, refsByNet } = buildConnectivity(design, components);
  const citationSources = citationContext({ evidence, inputs, guidance });
  const passiveRoles = [];

  for (const component of components) {
    const ref = text(component.ref);
    if (!ref) errors.push(issue('component-ref-missing', '设计元件缺少 ref，无法绑定电气角色或负载通路。'));
    const role = text(component.electricalRole);
    const resistorLike = isResistorComponent(component);
    const parsedValue = resistorLike ? numericResistance(component.value) : null;
    const nets = [...(netsByRef.get(ref) || [])];
    if (role && !ROLE_SET.has(role)) errors.push(issue('electrical-role-invalid', `元件 ${ref} 的 electricalRole 不在通用角色枚举中。`, { ref, electricalRole: role }));
    const roleRow = { ref, electricalRole: role || null, value: component.value ?? '', parsedValue, nets, explicitPurpose: explicitPurpose(component) };
    if (role || parsedValue !== null || resistorLike) passiveRoles.push(roleRow);

    if ((role === 'current-limit' || role === 'routing-bridge') && !resistorLike) {
      errors.push(issue('passive-role-not-resistor', `元件 ${ref} 声明 ${role}，但其 librarySymbol/器件类型不是电阻。`, { ref, electricalRole: role }));
    }

    if (parsedValue === 0 && !explicitPurpose(component)) {
      errors.push(issue('zero-ohm-purpose-missing', `0Ω 元件 ${ref} 必须声明通用电气用途。`, { ref }));
    }
    if (role === 'routing-bridge' && parsedValue !== 0) {
      if (parsedValue === null) errors.push(issue('routing-bridge-value-unknown', `routing-bridge 元件 ${ref} 的值无法确认是否为 0Ω。`, { ref }));
      else errors.push(issue('routing-bridge-value-nonzero', `routing-bridge 元件 ${ref} 必须为 0Ω。`, { ref, value: component.value }));
    }
    if (role === 'current-limit') {
      if (parsedValue === null) errors.push(issue('current-limit-value-unknown', `current-limit 元件 ${ref} 的阻值未知，不能凭空补值。`, { ref, value: component.value }));
      else if (!(parsedValue > 0)) errors.push(issue('current-limit-value-nonpositive', `current-limit 元件 ${ref} 必须使用正阻值，0Ω 不能代替限流。`, { ref, value: component.value }));
      const pinNets = asArray(component.pins).map(pin => netsByPin.get(`${ref}.${text(pin?.number || pin?.pad)}`) || new Set());
      const allTerminalsConnected = pinNets.length >= 2 && pinNets.every(pinSet => pinSet.size > 0);
      if (nets.length < 2 && allTerminalsConnected) errors.push(issue('current-limit-same-net', `current-limit 元件 ${ref} 的两个端点落在同一网络，不能作为跨网限流元件。`, { ref, net: nets[0] }));
      else if (nets.length < 2) errors.push(issue('current-limit-path-missing', `current-limit 元件 ${ref} 没有可核对的两端网络。`, { ref }));
    }
    if (POSITIVE_RESISTOR_ROLES.has(role)) {
      if (!resistorLike) {
        errors.push(issue('passive-role-not-resistor', `元件 ${ref} 声明 ${role}，但其 librarySymbol/器件类型不是电阻。`, { ref, electricalRole: role }));
      } else if (parsedValue === null) {
        errors.push(issue('passive-role-value-unknown', `${role} 元件 ${ref} 的阻值未知，不能凭空补值。`, { ref, electricalRole: role, value: component.value }));
      } else if (!(parsedValue > 0)) {
        errors.push(issue('passive-role-value-nonpositive', `${role} 元件 ${ref} 必须使用正阻值，0Ω 不能借角色名绕过电气约束。`, { ref, electricalRole: role, value: component.value }));
      }
      const pinNets = asArray(component.pins).map(pin => netsByPin.get(`${ref}.${text(pin?.number || pin?.pad)}`) || new Set());
      const allTerminalsConnected = pinNets.length >= 2 && pinNets.every(pinSet => pinSet.size > 0);
      if (nets.length < 2 && allTerminalsConnected) {
        errors.push(issue('passive-role-same-net', `${role} 元件 ${ref} 的两个端点落在同一网络，不能确认其串联/偏置作用。`, { ref, electricalRole: role, net: nets[0] }));
      } else if (nets.length < 2) {
        errors.push(issue('passive-role-path-missing', `${role} 元件 ${ref} 没有可核对的两端网络。`, { ref, electricalRole: role }));
      }
    }
  }

  const loadMatches = matchLoadComponents(components, evidence);
  const loadRefs = loadMatches.map(match => match.component.ref);
  const loadMatchByRef = new Map(loadMatches.map(match => [match.component.ref, match]));
  const assessments = asArray(design.loadAssessments).map(normalizedAssessment);
  const assessmentByRef = new Map();
  for (const assessment of assessments) {
    if (!assessment.ref) {
      errors.push(issue('load-assessment-ref-missing', '负载电流方案缺少 ref，无法绑定到器件。'));
      continue;
    }
    if (assessmentByRef.has(assessment.ref)) errors.push(issue('load-assessment-duplicate', `负载 ${assessment.ref} 重复提供 loadAssessment。`, { ref: assessment.ref }));
    assessmentByRef.set(assessment.ref, assessment);
    if (!componentByRef.has(assessment.ref)) errors.push(issue('load-assessment-unknown-load', `loadAssessment 的 ref ${assessment.ref} 不在设计元件中。`, { ref: assessment.ref }));
    else if (!loadRefs.includes(assessment.ref)) warnings.push(issue('load-assessment-non-load', `元件 ${assessment.ref} 没有被证据识别为 display/LED 负载，方案仍按显式输入保留。`, { ref: assessment.ref }));
    if (!CURRENT_CONTROLS.has(assessment.currentControl)) errors.push(issue('load-control-invalid', `负载 ${assessment.ref} 的 currentControl 必须为 resistor、regulated 或 unresolved。`, { ref: assessment.ref }));
  }

  if (loadRefs.length && !assessments.length) {
    errors.push(issue('load-assessment-missing', `识别到 ${loadRefs.join(', ')} 等显示/LED 负载，但未提供通用负载电流控制方案。`, { refs: loadRefs }));
  }
  for (const ref of loadRefs) {
    if (!assessmentByRef.has(ref)) errors.push(issue('load-assessment-missing', `显示/LED 负载 ${ref} 缺少 loadAssessment。`, { ref }));
  }

  const reviewedAssessments = assessments.map(assessment => {
    const assessmentIssues = [];
    // Explicitly unresolved facts are blocking in every control mode.  They
    // must not be hidden inside a resistor/regulated assessment while the
    // top-level review reports ready.
    for (const item of assessment.unresolved) {
      const message = `${assessment.ref}: ${item}`;
      unresolved.push(message);
      assessmentIssues.push(`unresolved:${item}`);
    }
    const loadComponent = componentByRef.get(assessment.ref);
    if (!loadComponent) return { ...assessment, status: 'invalid', issues: [...assessmentIssues, 'unknown-load'] };
    if (assessment.currentControl === 'resistor') {
      if (!assessment.components.length) {
        assessmentIssues.push('current-limit-component-missing');
        errors.push(issue('current-limit-component-missing', `负载 ${assessment.ref} 的 resistor 方案必须列出 current-limit 元件。`, { ref: assessment.ref }));
      }
      for (const selectedRef of assessment.components) {
        const selected = componentByRef.get(selectedRef);
        if (!selected) {
          assessmentIssues.push(`unknown-component:${selectedRef}`);
          errors.push(issue('load-component-unknown', `负载 ${assessment.ref} 引用了不存在的控制元件 ${selectedRef}。`, { ref: selectedRef, loadRef: assessment.ref }));
          continue;
        }
        const role = text(selected.electricalRole);
        const parsedValue = isResistorComponent(selected) ? numericResistance(selected.value) : null;
        if (role !== 'current-limit') {
          assessmentIssues.push(`not-current-limit:${selectedRef}`);
          if (!role) {
            errors.push(issue('load-component-role-missing', `负载 ${assessment.ref} 选用的 ${selectedRef} 没有声明 electricalRole=current-limit。`, { ref: selectedRef, loadRef: assessment.ref }));
          } else {
            errors.push(issue('load-component-not-current-limit', `负载 ${assessment.ref} 选用的 ${selectedRef} 没有声明为 current-limit。`, { ref: selectedRef, loadRef: assessment.ref }));
          }
        }
        if (!isResistorComponent(selected)) {
          assessmentIssues.push(`not-resistor:${selectedRef}`);
          errors.push(issue('passive-role-not-resistor', `负载 ${assessment.ref} 的控制元件 ${selectedRef} 不是电阻。`, { ref: selectedRef, loadRef: assessment.ref }));
        } else if (parsedValue === null) {
          assessmentIssues.push(`value-unknown:${selectedRef}`);
          errors.push(issue('current-limit-value-unknown', `负载 ${assessment.ref} 的控制元件 ${selectedRef} 阻值未知。`, { ref: selectedRef, loadRef: assessment.ref }));
        } else if (!(parsedValue > 0)) {
          assessmentIssues.push(`value-nonpositive:${selectedRef}`);
          errors.push(issue('current-limit-value-nonpositive', `负载 ${assessment.ref} 的控制元件 ${selectedRef} 不是正阻值。`, { ref: selectedRef, loadRef: assessment.ref }));
        }
        const isOnPath = currentLimiterPathIsExplicitAndDirect({
          selected,
          load: loadComponent,
          assessment,
          netsByRef,
          netsByPin,
          refsByNet,
          componentByRef,
        });
        if (!isOnPath) {
          assessmentIssues.push(`path-missing:${selectedRef}`);
          errors.push(issue('load-path-missing', `负载 ${assessment.ref} 的控制元件 ${selectedRef} 不在可核对的连通路径上。`, { ref: selectedRef, loadRef: assessment.ref }));
        }
      }
      const channelPlan = loadChannelPlan(loadComponent, loadMatchByRef.get(assessment.ref)?.evidence, assessment);
      if (channelPlan.ambiguous) {
        const message = `${assessment.ref}: 无法从引脚名称确定显示通道/共用端，请在 loadAssessment.channels 中明确声明。`;
        unresolved.push(message);
        assessmentIssues.push('channels-ambiguous');
      } else {
        for (const channel of channelPlan.channels) {
          const channelPin = findLoadPin(loadComponent, channel);
          if (!channelPin) {
            assessmentIssues.push(`channel-pin-unknown:${channel.pin}`);
            errors.push(issue('load-channel-pin-unknown', `负载 ${assessment.ref} 的通道 ${channel.pin} 不存在于器件引脚中。`, { ref: assessment.ref, channel: channel.pin }));
            continue;
          }
          const pinNets = netsByPin.get(`${assessment.ref}.${text(channelPin.number || channelPin.pad)}`) || new Set();
          const common = /common|cathode|return|shared/i.test(text(channel.purpose));
          if (common) {
            if (!pinNets.size) {
              errors.push(issue('load-channel-uncovered', `负载 ${assessment.ref} 的共用端 ${channel.pin} 没有已核对的网络。`, { ref: assessment.ref, channel: channel.pin }));
            }
            continue;
          }
          const covered = assessment.components.some(selectedRef => {
            const selected = componentByRef.get(selectedRef);
            return selected && text(selected.electricalRole) === 'current-limit' && currentLimiterPathIsExplicitAndDirect({
              selected,
              load: loadComponent,
              channelPin,
              assessment,
              netsByRef,
              netsByPin,
              refsByNet,
              componentByRef,
            });
          });
          if (!covered) {
            assessmentIssues.push(`channel-uncovered:${channel.pin}`);
            errors.push(issue('load-channel-uncovered', `负载 ${assessment.ref} 的通道 ${channel.pin} 未被已声明的 current-limit 通路覆盖。`, { ref: assessment.ref, channel: channel.pin }));
          }
        }
      }
    } else if (assessment.currentControl === 'regulated') {
      if (!citationMatches(assessment.basis, citationSources)) {
        assessmentIssues.push('regulated-source-missing');
        errors.push(issue('regulated-source-missing', `负载 ${assessment.ref} 声明 regulated，但引用的 guidance/source 不在当前资料上下文中。`, { ref: assessment.ref }));
      } else if (!regulatedSourceMatches(assessment.basis, citationSources)) {
        assessmentIssues.push('regulated-source-not-constant-current');
        errors.push(issue('regulated-source-not-constant-current', `负载 ${assessment.ref} 的当前引用没有明确恒流功能，不能把最大电流或布局建议当作 regulated 依据。`, { ref: assessment.ref }));
      }
      if (!assessment.driverRefs.length) {
        assessmentIssues.push('regulated-driver-missing');
        errors.push(issue('regulated-driver-missing', `负载 ${assessment.ref} 的 regulated 方案必须声明 driverRefs 并核对实际连接。`, { ref: assessment.ref }));
      }
      for (const driverRef of assessment.driverRefs) {
        const driver = componentByRef.get(driverRef);
        if (!driver) {
          assessmentIssues.push(`regulated-driver-unknown:${driverRef}`);
          errors.push(issue('regulated-driver-unknown', `负载 ${assessment.ref} 引用了不存在的驱动器 ${driverRef}。`, { ref: driverRef, loadRef: assessment.ref }));
        } else if (isResistorComponent(driver) || /(capacitor|^c(?:$|[_\-\s]))/i.test(componentSymbol(driver))) {
          assessmentIssues.push(`regulated-driver-not-driver:${driverRef}`);
          errors.push(issue('regulated-driver-not-driver', `负载 ${assessment.ref} 的 driverRefs ${driverRef} 指向无源器件，不是可验证的驱动器。`, { ref: driverRef, loadRef: assessment.ref }));
        } else if (!driverConnectedToLoad({ driverRef, loadRef: assessment.ref, assessment, netsByRef, refsByNet })) {
          assessmentIssues.push(`regulated-driver-disconnected:${driverRef}`);
          errors.push(issue('regulated-driver-disconnected', `负载 ${assessment.ref} 的驱动器 ${driverRef} 没有与负载或显式通路相连。`, { ref: driverRef, loadRef: assessment.ref }));
        }
      }
      const channelPlan = loadChannelPlan(loadComponent, loadMatchByRef.get(assessment.ref)?.evidence, assessment);
      if (channelPlan.ambiguous) {
        unresolved.push(`${assessment.ref}: regulated 方案无法从引脚名称确定显示通道/共用端。`);
        assessmentIssues.push('channels-ambiguous');
      } else {
        for (const channel of channelPlan.channels) {
          const channelPin = findLoadPin(loadComponent, channel);
          if (!channelPin) {
            assessmentIssues.push(`channel-pin-unknown:${channel.pin}`);
            errors.push(issue('load-channel-pin-unknown', `负载 ${assessment.ref} 的通道 ${channel.pin} 不存在于器件引脚中。`, { ref: assessment.ref, channel: channel.pin }));
            continue;
          }
          if (/common|cathode|return|shared/i.test(text(channel.purpose))) continue;
          const covered = assessment.driverRefs.some(driverRef => componentByRef.has(driverRef) && driverConnectedToChannel({
            driverRef,
            loadRef: assessment.ref,
            channelPin,
            assessment,
            netsByRef,
            netsByPin,
          }));
          if (!covered) {
            assessmentIssues.push(`channel-uncovered:${channel.pin}`);
            errors.push(issue('load-channel-uncovered', `负载 ${assessment.ref} 的 regulated 通道 ${channel.pin} 没有已声明且相连的驱动器。`, { ref: assessment.ref, channel: channel.pin }));
          }
        }
      }
    } else if (assessment.currentControl === 'unresolved') {
      const channelPlan = loadChannelPlan(loadComponent, loadMatchByRef.get(assessment.ref)?.evidence, assessment);
      for (const channel of channelPlan.channels) {
        if (/common|cathode|return|shared/i.test(text(channel.purpose))) continue;
        const channelPin = findLoadPin(loadComponent, channel);
        if (!channelPin) continue;
        const driverRef = uncontrolledChannelDriver({ load: loadComponent, channelPin, netsByPin, netsByRef, refsByNet, componentByRef });
        if (driverRef) {
          assessmentIssues.push(`uncontrolled-connected-path:${channel.pin}`);
          errors.push(issue('load-uncontrolled-connected-path', `负载 ${assessment.ref} 的通道 ${channel.pin} 已直接接通 ${driverRef} 输出，但电流控制仍为 unresolved。请提出带计算假设的正阻值限流候选，或提供实际恒流依据；若方案未定，应暂缓接通该通道。`, { ref: assessment.ref, channel: channel.pin, driverRef }));
        }
      }
      const rows = assessment.unresolved.length ? [] : ['负载电流控制方案未确定'];
      for (const item of rows) {
        const message = `${assessment.ref}: ${item}`;
        unresolved.push(message);
      }
      assessmentIssues.push(...rows.map(item => `unresolved:${item}`));
    }
    const status = assessment.currentControl === 'unresolved'
      ? 'unresolved'
      : (assessmentIssues.length ? 'invalid' : 'reviewed');
    return { ...assessment, status, issues: assessmentIssues };
  });

  // A cited requirement/guidance entry can explain why an unresolved load is
  // intentionally deferred, but it cannot make the electrical review pass.
  if (loadRefs.length && !assessments.length && (inputs || requirements || guidance)) {
    unresolved.push('需要补充每个 display/LED 负载的通用电流控制方案；无需提供完整逐脚表。');
  }
  const peripherals=reviewPeripherals(design,{evidence,inputs});
  errors.push(...peripherals.errors);unresolved.push(...peripherals.unresolved);
  const blockingCodes = new Set(errors.map(error => error.code));
  const ready = errors.length === 0 && unresolved.length === 0;
  return {
    errors,
    warnings,
    unresolved,
    passiveRoles,
    loadAssessments: reviewedAssessments,
    peripheralAssessments:peripherals.peripheralAssessments,
    decouplingOwners:peripherals.decouplingOwners,
    readiness: {
      ready,
      status: ready ? 'ready' : 'not-ready',
      blockingErrors: [...blockingCodes],
      unresolved: [...unresolved],
      scope: 'static-circuit-review',
      hardwareVerified: false,
      electricalPerformanceVerified: false,
      boundary: '仅核对显式角色、网络拓扑和来源引用；不等于硬件、电流、热、EMC 或实物性能验证。',
    },
  };
}

export const circuitReviewSchema = Object.freeze({
  input: {
    componentElectricalRole: ELECTRICAL_ROLES,
    loadAssessment: {
      ref: 'string',
      currentControl: ['resistor', 'regulated', 'unresolved'],
      components: 'string[]',
      channels: '{pin:string,purpose?:string}[]',
      path: 'string[]',
      driverRefs: 'string[]',
      basis: 'string|object',
      unresolved: 'string[]',
    },
  },
  output: {
    errors: 'ReviewIssue[]',
    warnings: 'ReviewIssue[]',
    unresolved: 'string[]',
    passiveRoles: 'PassiveRole[]',
    loadAssessments: 'LoadAssessmentReview[]',
    readiness: '{ready:boolean,status:"ready"|"not-ready",blockingErrors:string[],unresolved:string[],scope:"static-circuit-review",hardwareVerified:false,electricalPerformanceVerified:false}',
  },
});

