import { createHash } from 'node:crypto';

// This module is deliberately a small, source-bound inventory check.  It does
// not inspect CAD files, infer a circuit from an AD report, or turn a model
// assumption into a requirement.  A passive obligation exists only when one
// of the visible user fields or an exact guidance citation contains a nearby
// quantity, value and passive noun.

const USER_FIELDS = ['requirements', 'power', 'interfaces'];
const COUNT_WORDS = new Map([
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
  ['零', 0], ['一', 1], ['壹', 1], ['两', 2], ['兩', 2], ['二', 2], ['贰', 2], ['貳', 2],
  ['三', 3], ['叁', 3], ['參', 3], ['四', 4], ['肆', 4], ['五', 5], ['伍', 5],
  ['六', 6], ['陆', 6], ['陸', 6], ['七', 7], ['柒', 7], ['八', 8], ['捌', 8],
  ['九', 9], ['玖', 9], ['十', 10],
]);
const SI = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
const NUMBER = String.raw`(?:\d+(?:\.\d*)?|\.\d+)`;
const COUNT = String.raw`(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|零|一|壹|两|兩|二|贰|貳|三|叁|參|四|肆|五|伍|六|陆|陸|七|柒|八|捌|九|玖|十)`;
const VALUE = String.raw`(?:zero[-\s]?ohms?|zero[-\s]?ohm|零欧(?:姆)?|0\s*(?:R|Ω|ohms?|欧(?:姆)?)|${NUMBER}\s*(?:[pnumkKMGTµμ]?\s*(?:R|Ω|ohms?|欧(?:姆)?|F)|[pnumkKMGTµμ]))`;
const NOUN = String.raw`(?:电阻|电容|resistors?|capacitors?)`;
// A quantity and a value must have an explicit separator.  Without this,
// `100pF电容` can backtrack as `10` + `0pF`, and `10k电阻` as `1` + `0k`.
const COUNT_VALUE_SEPARATOR = String.raw`(?:(?:\s*(?:个|只|颗|枚|pcs?\b|pieces?\b)\s*)|(?:\s*[x×]\s*)|(?:\s+))`;
const VALUE_BOUNDARY = String.raw`(?![A-Za-z0-9_.])`;
const PAIR_FORWARD = new RegExp(String.raw`(${COUNT})${COUNT_VALUE_SEPARATOR}(${VALUE})${VALUE_BOUNDARY}\s*([^,，。；;：:\n\r]{0,30}?)\s*(${NOUN})`, 'giu');
const PAIR_REVERSE = new RegExp(String.raw`(${VALUE})${VALUE_BOUNDARY}\s+([^,，。；;：:\n\r]{0,20}?)\s*(${COUNT})\s*(?:个|只|颗|枚|pcs?\b|pieces?\b)?\s*(${NOUN})`, 'giu');

function compact(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function parseCount(raw) {
  const token = compact(raw).toLocaleLowerCase('en-US');
  if (/^\d+$/.test(token)) return Number(token);
  if (COUNT_WORDS.has(token)) return COUNT_WORDS.get(token);
  if (/^[一二两三四五六七八九十壹贰叁肆伍陆柒捌玖貳參]+$/.test(token)) {
    const digits = [...token].map(ch => COUNT_WORDS.get(ch));
    if (digits.length === 1) return digits[0];
    if (digits.length === 2 && digits[0] === 1) return 10 + digits[1];
    if (digits.length === 2 && digits[1] === 0) return digits[0] * 10;
  }
  return null;
}

function tidyNumber(value) {
  return Number(value.toPrecision(12)).toString();
}

function formatEngineering(value, kind) {
  if (kind === 'resistor') {
    if (value === 0) return '0Ω';
    const units = [[1e9, 'GΩ'], [1e6, 'MΩ'], [1e3, 'kΩ'], [1, 'Ω'], [1e-3, 'mΩ']];
    const [factor, unit] = units.find(([scale]) => Math.abs(value) >= scale) || units.at(-1);
    return `${tidyNumber(value / factor)}${unit}`;
  }
  const units = [[1, 'F'], [1e-3, 'mF'], [1e-6, 'µF'], [1e-9, 'nF'], [1e-12, 'pF']];
  const [factor, unit] = units.find(([scale]) => Math.abs(value) >= scale) || units.at(-1);
  return `${tidyNumber(value / factor)}${unit}`;
}

function parsePassiveValue(raw, hintKind) {
  const original = compact(raw).normalize('NFKC');
  if (!original) return null;
  const allowedTail = tail => !tail || /^\s*(?:\/|±|\+\/|-\/|\(|\[)/u.test(tail);
  const zero = original.match(/^(?:zero[-\s]?ohms?|零欧(?:姆)?|0\s*(?:R|Ω|ohms?|欧(?:姆)?))(?:\b|\/|$)/iu);
  if (zero) {
    if (hintKind === 'capacitor' || !allowedTail(original.slice(zero[0].length))) return null;
    return { kind: 'resistor', siValue: 0, normalized: '0Ω', raw: original };
  }
  const match = original.match(new RegExp(`^(${NUMBER})\\s*([pnumkKMGTµμ]?)(?:\\s*(R|Ω|ohms?|欧(?:姆)?|F))?`, 'iu'));
  if (!match) return null;
  const number = Number(match[1]);
  const prefix = match[2] || '';
  const suffix = match[3] || (/[pnumkKMGTµμ]/.test(prefix) ? '' : undefined);
  if (!allowedTail(original.slice(match[0].length))) return null;
  let kind;
  const explicitKind = /^F$/i.test(suffix || '') ? 'capacitor' : /^(?:R|Ω|ohms?|欧(?:姆)?)$/iu.test(suffix || '') ? 'resistor' : undefined;
  if (explicitKind && hintKind && explicitKind !== hintKind) return null;
  if (explicitKind) kind = explicitKind;
  else if (prefix && hintKind) kind = hintKind;
  if (!kind || !Number.isFinite(number) || SI[prefix] === undefined) return null;
  const siValue = number * SI[prefix];
  return { kind, siValue, normalized: formatEngineering(siValue, kind), raw: original };
}

function quantityScope(text, start, end) {
  const before = text.slice(Math.max(0, start - 40), start);
  const after = text.slice(end, end + 40);
  const negation = String.raw`(?:不需要|不要|无需|不必|不保留|不含|without|no|not\s+required|do\s+not|don't)`;
  const optional = String.raw`(?:可选|任选|optional(?:ly)?|if\s+desired)`;
  const negated = new RegExp(`${negation}[\\s:：,，。；;]*$`, 'iu').test(before)
    || new RegExp(`^\\s*${negation}(?:\\b|[\\s:：,，。；;]|$)`, 'iu').test(after);
  if (negated) return { negated: true };
  const optionalized = new RegExp(`${optional}[\\s:：,，。；;]*$`, 'iu').test(before)
    || new RegExp(`^\\s*${optional}(?:\\b|[\\s:：,，。；;]|$)`, 'iu').test(after);
  if (optionalized) return { unsupported: true };
  // A numeric range is intentionally left unknown.  The pair parser can
  // otherwise start at the upper bound in `0-3个100pF电容` and misread it as
  // an exact quantity of three.
  if (/(?:\d+\s*[-–—~～]\s*)$/u.test(before)
    || /^\s*[-–—~～]\s*\d+/u.test(after)) return { unsupported: true };
  if (/(?:at\s+least|至少|不少于|最少|min(?:imum)?\s*(?:of)?|no\s+fewer\s+than)[\s:：,，]*$/iu.test(before)) return { scope: 'at-least' };
  if (/(?:at\s+most|至多|最多|不超过|no\s+more\s+than)[\s:：,，]*$/iu.test(before)) return { scope: 'at-most' };
  if (/(?:at\s+least|至少|不少于|最少|min(?:imum)?\s*(?:of)?|no\s+fewer\s+than)[\s:：,，]*$/iu.test(after)) return { scope: 'at-least' };
  if (/(?:at\s+most|至多|最多|不超过|no\s+more\s+than)[\s:：,，]*$/iu.test(after)) return { scope: 'at-most' };
  return { scope: 'exact' };
}

function nounKind(noun) {
  return /电容|capacitor/i.test(noun) ? 'capacitor' : 'resistor';
}

function makeSource(base, text, extra = {}) {
  return {
    ...base,
    text,
    ...extra,
  };
}

function perMemberScope(text,start,end){
  // A comma may separate members, so use sentence/statement separators here.
  const left=Math.max(...['。','；',';','\n','\r'].map(s=>text.lastIndexOf(s,start)));
  const before=text.slice(left+1,start),after=text.slice(end).split(/[。；;\n\r]/u)[0];
  const marker=before.match(/(?:各(?:有|接|放置|设置|配置)?|分别(?:有|接|放置|设置|配置)?|each\s+(?:has|uses|gets|requires))\s*$/iu);
  const distributed=Boolean(marker)||/每(?:个|只|颗|路|一)|各|分别|\beach\b|\bper\s+(?:pin|input|channel|device)\b/iu.test(before+' '+after);
  if(!distributed)return null;
  if(!marker)return {ambiguous:true};
  const prefix=before.slice(0,marker.index);
  const token=String.raw`[A-Za-z][A-Za-z0-9_./+-]*`;
  const listed=prefix.match(new RegExp(`(${token}(?:\\s*[、,，]\\s*${token})+)(?:\\s*(?:引脚|通道|输入|pins?|inputs?|channels?))?\\s*$`,'iu'));
  if(!listed)return {ambiguous:true};
  const members=listed[1].split(/\s*[、,，]\s*/u);
  if(new Set(members.map(s=>s.toLowerCase())).size!==members.length)return {ambiguous:true};
  return {members,multiplier:members.length};
}

function parseRows(text, sourceBase) {
  const rows = [];
  const rawInput = String(text ?? '');
  const input = rawInput.normalize('NFKC');
  const add = (match, countRaw, valueRaw, middleRaw, nounRaw) => {
    const perMember=perMemberScope(input,match.index,match.index+match[0].length);
    const perMemberQuantity=parseCount(countRaw);
    const quantity=perMemberQuantity*(perMember?.multiplier||1);
    const kind = nounKind(nounRaw);
    const parsed = parsePassiveValue(valueRaw, kind);
    const scope = quantityScope(input, match.index, match.index + match[0].length);
    if (scope.negated || scope.unsupported || !Number.isInteger(quantity) || quantity < 1 || !parsed || parsed.kind !== kind) return;
    const matched = match[0].trim();
    const middle = compact(middleRaw);
    const routing = kind === 'resistor' && (/(?:跨线|jumper|routing[-\s]?bridge)/iu.test(middle) || /(?:跨线|jumper|routing[-\s]?bridge)/iu.test(matched));
    const clause = sourceClause(input, match.index, match.index + match[0].length);
    const ambiguous = perMember?.ambiguous===true||(/(?:另一个|另[一二]个|another|each|分别)/iu.test(clause) && /(?:和|与|及|and|&)/iu.test(clause));
    rows.push({
      kind,
      value: parsed.normalized,
      valueInfo: parsed,
      quantity: !ambiguous && scope.scope === 'exact' ? quantity : undefined,
      minimumQuantity: !ambiguous && scope.scope === 'at-least' ? quantity : undefined,
      maximumQuantity: !ambiguous && scope.scope === 'at-most' ? quantity : undefined,
      scope: ambiguous ? 'ambiguous' : scope.scope,
      ambiguous,
      electricalRole: routing ? 'routing-bridge' : undefined,
      source: makeSource(sourceBase, matched, { matchText: matched, ambiguous, ...(perMember?{distribution:{...perMember,perMemberQuantity}}:{}), _rawInput: sourceBase.type === 'user-input' ? rawInput : undefined }),
    });
  };
  for (const match of input.matchAll(PAIR_FORWARD)) add(match, match[1], match[2], match[3], match[4]);
  for (const match of input.matchAll(PAIR_REVERSE)) add(match, match[3], match[1], match[2], match[4]);
  return rows;
}

function sourceTextWithClause(source, text, matchText) {
  if (source.type !== 'user-input' || typeof text !== 'string' || !matchText) return text;
  const start = text.indexOf(matchText);
  if (start < 0) return text;
  const left = Math.max(text.lastIndexOf('。', start), text.lastIndexOf('；', start), text.lastIndexOf(';', start), text.lastIndexOf('，', start), text.lastIndexOf(',', start), text.lastIndexOf('\n', start));
  const rightCandidates = [text.indexOf('。', start + matchText.length), text.indexOf('；', start + matchText.length), text.indexOf(';', start + matchText.length), text.indexOf('，', start + matchText.length), text.indexOf(',', start + matchText.length), text.indexOf('\n', start + matchText.length)].filter(index => index >= 0);
  const right = rightCandidates.length ? Math.min(...rightCandidates) : text.length;
  return text.slice(left + 1, right).trim();
}

function sourceClause(text, start, end) {
  const left = Math.max(text.lastIndexOf('。', start), text.lastIndexOf('；', start), text.lastIndexOf(';', start), text.lastIndexOf('，', start), text.lastIndexOf(',', start), text.lastIndexOf('\n', start));
  const rightCandidates = [text.indexOf('。', end), text.indexOf('；', end), text.indexOf(';', end), text.indexOf('，', end), text.indexOf(',', end), text.indexOf('\n', end)].filter(index => index >= 0);
  const right = rightCandidates.length ? Math.min(...rightCandidates) : text.length;
  return text.slice(left + 1, right);
}

function sourceRows(inputs, guidance) {
  const rows = [];
  for (const field of USER_FIELDS) {
    const value = inputs?.[field];
    const texts = Array.isArray(value) ? value.filter(item => typeof item === 'string') : [value];
    for (const text of texts) {
      if (typeof text !== 'string' || !text.trim()) continue;
      rows.push(...parseRows(text, { type: 'user-input', authority: 'user', field }));
    }
  }
  const evidence = new Map((inputs?.evidence || []).filter(row => row?.id).map(row => [row.id, row]));
  for (const row of Array.isArray(guidance) ? guidance : []) {
    // Limit/applicability prose may contain ratings or pin counts.  Only
    // application/peripheral guidance is a recommendation source here.
    if (row?.category === 'limits' || row?.category === 'unused-pin') continue;
    for (const citation of Array.isArray(row?.citations) ? row.citations : []) {
      if (typeof citation?.quote !== 'string' || !citation.quote.trim()) continue;
      const source = evidence.get(citation.sourceId) || {};
      const base = {
        type: 'guidance-citation',
        authority: 'guidance',
        sourceId: citation.sourceId ?? null,
        document: citation.document ?? source.document ?? null,
        page: citation.page ?? source.page ?? null,
        section: citation.section ?? source.section ?? null,
        quote: citation.quote,
      };
      rows.push(...parseRows(citation.quote, base));
    }
  }
  return rows;
}

function stableId(row) {
  const identity = [row.authority, row.kind, row.valueInfo.siValue, row.quantity, row.minimumQuantity, row.maximumQuantity, row.scope, row.electricalRole || ''];
  return `passive-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 16)}`;
}

function mergeRows(rows) {
  const merged = new Map();
  for (const row of rows) {
    const authority = row.source.authority || (row.source.type === 'user-input' ? 'user' : 'guidance');
    const key = `${authority}|${row.kind}|${row.valueInfo.siValue}|${row.quantity}|${row.minimumQuantity}|${row.maximumQuantity}|${row.scope}|${row.electricalRole || ''}`;
    const existing = merged.get(key);
    if (existing) {
      const source = { ...row.source, text: sourceTextWithClause(row.source, row.source._rawInput, row.source.matchText) };
      delete source._rawInput;
      existing.sources.push(source);
      continue;
    }
    const source = { ...row.source, text: sourceTextWithClause(row.source, row.source._rawInput, row.source.matchText) };
    delete source._rawInput;
    const obligation = {
      id: stableId({ ...row, authority }),
      kind: row.kind,
      partKind: row.kind,
      value: row.value,
      normalizedValue: row.value,
      valueInfo: { ...row.valueInfo },
      quantity: row.quantity,
      requiredQuantity: row.quantity,
      minimumQuantity: row.minimumQuantity,
      maximumQuantity: row.maximumQuantity,
      scope: row.scope,
      ambiguous: row.ambiguous === true,
      electricalRole: row.electricalRole,
      authority,
      hard: authority === 'user' && row.ambiguous !== true,
      recommended: authority === 'guidance',
      source,
      sources: [source],
    };
    merged.set(key, obligation);
  }
  return [...merged.values()];
}

/**
 * Compile passive inventory obligations from visible user inputs and exact
 * guidance citations.  The return value is an array for simple callers; the
 * non-enumerable aliases make it convenient to pass through a review object
 * without changing the stable array shape.
 */
export function compilePassiveObligations({ inputs = {}, guidance = [] } = {}) {
  const obligations = mergeRows(sourceRows(inputs, guidance));
  const warnings = obligations.filter(row => row.ambiguous).map(row => `来源对${row.value} ${row.kind === 'resistor' ? '电阻' : '电容'}的数量表达存在歧义，未作为硬性数量要求；请补充明确总数。`);
  Object.defineProperties(obligations, {
    obligations: { value: obligations, enumerable: false },
    errors: { value: [], enumerable: false },
    warnings: { value: warnings, enumerable: false },
  });
  return obligations;
}

function componentKind(component, parsed) {
  const explicit = [component?.passiveKind, component?.componentKind, component?.electricalKind, component?.kind]
    .find(value => /resistor|电阻/i.test(String(value || '')) || /capacitor|电容/i.test(String(value || '')));
  if (/capacitor|电容/i.test(String(explicit || ''))) return 'capacitor';
  if (/resistor|电阻/i.test(String(explicit || ''))) return 'resistor';
  const symbol = String(component?.librarySymbol || '');
  const ref = String(component?.ref || '');
  if (/capacitor|电容/i.test(symbol) || /(?:^|:)C(?:_|$)/i.test(symbol)) return 'capacitor';
  if (/resistor|电阻/i.test(symbol) || /(?:^|:)R(?:_|$)/i.test(symbol)) return 'resistor';
  // An unknown library symbol must not be classified from an R/C-looking
  // reference alone.  An explicit unit (R/Ω/F) still carries its own kind.
  if (symbol) return parsed?.kind;
  if (/^(?:C|CAP)(?:[A-Z0-9_-]|$)/i.test(ref)) return 'capacitor';
  if (/^(?:R|RJ|RES)(?:[A-Z0-9_-]|$)/i.test(ref)) return 'resistor';
  return parsed?.kind;
}

function componentValue(component) {
  const raw = component?.value ?? component?.Value ?? '';
  const hint = componentKind(component, null);
  const parsed = parsePassiveValue(raw, hint);
  if (!parsed) return null;
  const kind = componentKind(component, parsed);
  if (!kind || kind !== parsed.kind) return null;
  const role = component?.electricalRole ?? component?.properties?.electricalRole ?? component?.fields?.electricalRole;
  return { ...parsed, kind, role: typeof role === 'string' ? role : undefined };
}

function actualPassives(design) {
  return (Array.isArray(design?.components) ? design.components : []).filter(component => component?.dnp !== true && component?.in_bom !== false)
    .map(component => ({ component, parsed: componentValue(component) }))
    .filter(row => row.parsed);
}

function sameValue(left, right) {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= Number.EPSILON * scale * 8;
}

function coverageFor(obligation, actual) {
  const sameKind = actual.filter(row => row.parsed.kind === obligation.kind);
  const sameValueRows = sameKind.filter(row => sameValue(row.parsed.siValue, obligation.valueInfo.siValue));
  const sameRole = obligation.electricalRole
    ? sameValueRows.filter(row => row.parsed.role === obligation.electricalRole)
    : sameValueRows;
  const actualRows = obligation.electricalRole ? sameRole : sameValueRows;
  const atMost = obligation.maximumQuantity !== undefined;
  const required = obligation.minimumQuantity ?? obligation.quantity;
  const limitQuantity = actualRows.length;
  let status = obligation.ambiguous ? 'ambiguous' : atMost
    ? limitQuantity <= obligation.maximumQuantity ? 'satisfied' : 'over'
    : obligation.minimumQuantity!==undefined ? actualRows.length>=required?'satisfied':'under'
    : actualRows.length === required ? 'satisfied' : actualRows.length > required ? 'surplus' : 'under';
  if (!obligation.ambiguous && !atMost && obligation.electricalRole && sameValueRows.length >= required && sameRole.length < required) status = 'missing-role';
  else if (!obligation.ambiguous && !atMost && !sameValueRows.length && sameKind.length) status = 'value-mismatch';
  const matched = actualRows.map(row => row.component?.ref).filter(Boolean);
  return {
    obligation,
    kind: obligation.kind,
    value: obligation.value,
    requiredQuantity: obligation.quantity,
    minimumQuantity: obligation.minimumQuantity,
    maximumQuantity: obligation.maximumQuantity,
    actualQuantity: actualRows.length,
    actualKindQuantity: sameKind.length,
    matchedReferences: matched,
    status,
    hard: obligation.hard,
    authority: obligation.authority,
  };
}

/** Compare a frozen design's generic passive inventory against source-backed obligations. */
export function reviewPassiveCoverage(design, context = {}) {
  const obligations = Array.isArray(context?.obligations)
    ? context.obligations
    : compilePassiveObligations({ inputs: context?.inputs || {}, guidance: context?.guidance || [] });
  const actual = actualPassives(design);
  const coverage = obligations.map(obligation => coverageFor(obligation, actual));
  const errors = [];
  const warnings = [];
  for (const row of coverage) {
    if (row.status === 'satisfied') continue;
    if (row.status === 'ambiguous') {
      warnings.push(`来源对${row.value} ${row.kind === 'resistor' ? '电阻' : '电容'}的数量表达存在歧义，未作为硬性数量要求；请补充明确总数。`);
      continue;
    }
    if (row.status === 'surplus') {
      warnings.push(`${row.authority==='user'?'用户要求':'规格资料推荐'}的${row.requiredQuantity}×${row.value} ${row.kind === 'resistor' ? '电阻' : '电容'}出现额外器件（当前覆盖${row.actualQuantity}个），记录为surplus供复核。`);
      continue;
    }
    const countText = row.minimumQuantity !== undefined ? `至少${row.minimumQuantity}` : row.maximumQuantity !== undefined ? `最多${row.maximumQuantity}` : row.requiredQuantity;
    const label = `${countText}×${row.value} ${row.kind === 'resistor' ? '电阻' : '电容'}`;
    const sourceHint = row.obligation.source?.field ? `（来源${row.obligation.source.field}）` : '';
    if (row.hard) {
      if (row.status === 'missing-role') errors.push(`用户要求的${label}跨线用途未声明 electricalRole=routing-bridge${sourceHint}。`);
      else if (row.status === 'value-mismatch') errors.push(`用户要求的${label}数量/值未覆盖：当前同类器件有${row.actualKindQuantity}个，但没有足够的${row.value}${sourceHint}。`);
      else if (row.status === 'over') errors.push(`用户要求的${label}数量超出：当前覆盖${row.actualQuantity}个${sourceHint}。`);
      else errors.push(`用户要求的${label}数量不足：当前覆盖${row.actualQuantity}个${sourceHint}。`);
    } else {
      warnings.push(`规格资料推荐的${label}尚未完全覆盖（当前${row.actualQuantity}个），仅作应用建议${sourceHint}。`);
    }
  }
  return { errors, warnings, obligations, coverage };
}

export { parsePassiveValue, componentValue as passiveComponentValue };
