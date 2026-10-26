// Resolve model-authored, role-level pin intent after source facts have been
// expanded into concrete component pin tables. Legacy numeric endpoint strings
// remain valid and are intentionally left untouched for validateDesign to check.

const endpointKeys = new Set(['ref', 'pinName', 'pinNumber']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * Instructions for the model-facing electrical intent contract.
 *
 * The model plans by electrical role and exact source pin names; the host turns
 * those references into the numeric node strings required by KiCad. Keeping the
 * conversion here avoids asking a model to copy a manually numbered netlist.
 */
export const connectionIntentInstructions = `电气连接先按功能角色规划，再由宿主根据已展开的components[].pins转换为数字网表。你不需要抄写用户的完整逐脚连接，也不要猜测隐藏引脚或用语义近似名替代资料中的名称。
步骤3的design仍包含components、nets、nc、functions等原字段。nets[*].nodes、nc和functions[*].checks[*].nodes中的每个端点可使用既有数字字符串"<ref>.<pinNumber>"，也可使用命名对象{"ref":"<器件位号>","pinName":"<规格书或库中的精确引脚名>"}，或数字对象{"ref":"<器件位号>","pinNumber":"<components[].pins.number中的精确值>"}。宿主先按ref找到已展开的器件，再按大小写敏感、去掉首尾空白后的精确pinName/pinNumber解析；解析成功后统一写成"<ref>.<pinNumber>"。已有数字字符串保持原文以兼容旧设计，之后仍由设计校验检查是否真实存在。
只在资料或库明确给出引脚名后使用pinName。若同一器件存在重复且不唯一的引脚名，必须改用pinNumber；不要把DIN、DATA、D等名字自行视为同义词。不要填写同时含pinName和pinNumber的对象，也不要增加未定义字段。通用示例：{"name":"信号链路","nodes":[{"ref":"<发送器位号>","pinName":"<资料中的输出引脚名>"},{"ref":"<接收器位号>","pinNumber":"<库中的数字引脚号>"}]}。`;

function cloneDesign(design) {
  try {
    return structuredClone(design);
  } catch (error) {
    throw new Error(`设计无法安全复制，连接解析未执行：${error?.message || error}`);
  }
}

function componentIndex(components) {
  const byRef = new Map();
  components.forEach((component, index) => {
    if (!component || typeof component !== 'object' || Array.isArray(component) ||
        typeof component.ref !== 'string' || !component.ref.trim() || !Array.isArray(component.pins)) {
      throw new Error(`器件索引 ${index + 1} 缺少可解析的ref或pins数组，无法解析命名引脚。`);
    }
    const ref = component.ref.trim();
    if (byRef.has(ref)) throw new Error(`器件位号 "${ref}" 重复，无法按ref解析引脚。`);
    const pinsByNumber = new Map();
    const pinsByName = new Map();
    component.pins.forEach((pin, pinIndex) => {
      if (!pin || typeof pin !== 'object' || Array.isArray(pin) ||
          typeof pin.number !== 'string' || !pin.number.trim() || typeof pin.name !== 'string') {
        throw new Error(`器件 ${ref} 的引脚 ${pinIndex + 1} 缺少可解析的number/name。`);
      }
      const number = pin.number.trim();
      const name = pin.name.trim();
      const numbers = pinsByNumber.get(number) || [];
      numbers.push(pin);
      pinsByNumber.set(number, numbers);
      if (name) {
        const names = pinsByName.get(name) || [];
        names.push(pin);
        pinsByName.set(name, names);
      }
    });
    byRef.set(ref, { component, pinsByNumber, pinsByName });
  });
  return byRef;
}

function resolveEndpoint(endpoint, byRef) {
  // Existing numeric strings are a deliberately compatible escape hatch. The
  // design validator owns existence/format validation for these legacy values.
  if (typeof endpoint === 'string') return endpoint;
  if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
    throw new Error('引脚端点必须是"位号.数字引脚"字符串，或包含ref与pinName/pinNumber的对象。');
  }
  const keys = Object.keys(endpoint);
  if (keys.some(key => !endpointKeys.has(key))) {
    throw new Error(`引脚端点含未知字段，只允许ref、pinName或pinNumber：${keys.join('、')}。`);
  }
  if (typeof endpoint.ref !== 'string' || !endpoint.ref.trim()) {
    throw new Error('命名引脚端点必须提供非空字符串ref。');
  }
  const ref = endpoint.ref.trim();
  const hasName = own(endpoint, 'pinName');
  const hasNumber = own(endpoint, 'pinNumber');
  if (hasName && hasNumber) throw new Error(`引脚端点 ${ref} 同时提供pinName和pinNumber；只能选择一个。`);
  if (!hasName && !hasNumber) throw new Error(`引脚端点 ${ref} 缺少pinName或pinNumber。`);
  const selector = hasName ? endpoint.pinName : endpoint.pinNumber;
  const selectorKey = hasName ? 'pinName' : 'pinNumber';
  if (typeof selector !== 'string' || !selector.trim()) {
    throw new Error(`引脚端点 ${ref} 的${selectorKey}必须是非空字符串。`);
  }
  const entry = byRef.get(ref);
  if (!entry) throw new Error(`未找到器件位号 "${ref}" 的引脚表；请先提供已展开的components[].pins。`);
  const value = selector.trim();
  const candidates = hasName ? entry.pinsByName.get(value) || [] : entry.pinsByNumber.get(value) || [];
  if (!candidates.length) {
    if (hasName) throw new Error(`器件 ${ref} 没有名为 "${value}" 的引脚；请使用资料或库中的精确名称或pinNumber。`);
    throw new Error(`器件 ${ref} 没有数字引脚 "${value}"；请以components[].pins.number为准。`);
  }
  if (candidates.length > 1) {
    if (hasName) throw new Error(`器件 ${ref} 的引脚名 "${value}" 不唯一，请改用pinNumber。`);
    throw new Error(`器件 ${ref} 的数字引脚 "${value}" 重复，无法解析。`);
  }
  return `${ref}.${candidates[0].number.trim()}`;
}

function resolveNodeArray(nodes, byRef, label) {
  if (!Array.isArray(nodes)) throw new Error(`${label}必须是端点数组。`);
  return nodes.map(endpoint => resolveEndpoint(endpoint, byRef));
}

/**
 * Resolve named pin endpoints to numeric node strings without mutating input.
 * Components and all unrelated design fields are copied verbatim.
 */
export function resolveConnectionIntent(design) {
  if (!design || typeof design !== 'object' || Array.isArray(design) || !Array.isArray(design.components)) {
    throw new Error('连接意图需要包含components数组的design对象。');
  }
  const byRef = componentIndex(design.components);
  const resolved = cloneDesign(design);

  if (own(design, 'nets')) {
    if (!Array.isArray(design.nets)) throw new Error('design.nets必须是网络数组。');
    resolved.nets = design.nets.map((net, index) => {
      if (!net || typeof net !== 'object' || Array.isArray(net)) throw new Error(`网络 ${index + 1} 不是对象。`);
      if (!own(net, 'nodes')) return structuredClone(net);
      return {...structuredClone(net), nodes: resolveNodeArray(net.nodes, byRef, `网络 ${net.name || index + 1} 的nodes`)};
    });
  }
  if (own(design, 'nc')) resolved.nc = resolveNodeArray(design.nc, byRef, 'design.nc');
  if (own(design, 'functions')) {
    if (!Array.isArray(design.functions)) throw new Error('design.functions必须是功能检查数组。');
    resolved.functions = design.functions.map((fn, fnIndex) => {
      if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return structuredClone(fn);
      const result = structuredClone(fn);
      if (own(fn, 'checks')) {
        if (!Array.isArray(fn.checks)) throw new Error(`功能 ${fn.requirementId || fnIndex + 1} 的checks必须是数组。`);
        result.checks = fn.checks.map((check, checkIndex) => {
          if (!check || typeof check !== 'object' || Array.isArray(check)) return structuredClone(check);
          if (!own(check, 'nodes')) return structuredClone(check);
          return {...structuredClone(check), nodes: resolveNodeArray(check.nodes, byRef, `功能 ${fn.requirementId || fnIndex + 1} 的检查 ${checkIndex + 1} 的nodes`)};
        });
      }
      if (own(fn, 'layout')) {
        if (!Array.isArray(fn.layout)) throw new Error(`功能 ${fn.requirementId || fnIndex + 1} 的布局归属 layout 必须是数组。`);
        result.layout = fn.layout.map(relation => {
          if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return structuredClone(relation);
          const resolvedRelation = structuredClone(relation);
          for (const key of ['anchor','return']) if (own(relation,key)) resolvedRelation[key] = resolveEndpoint(relation[key],byRef);
          return resolvedRelation;
        });
      }
      return result;
    });
  }
  return resolved;
}

