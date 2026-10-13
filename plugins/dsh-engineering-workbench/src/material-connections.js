// Discover only pairs which accept the manual adapter contract. No tool execution or SQL guessing.
export function discoverMaterialConnections(schemas) {
  const groups = new Map();
  for (const tool of schemas) {
    const match = /^mcp__(.+)__(.+)$/.exec(tool.name || '');
    if (!match) continue;
    const schema = tool.parameters, properties = schema?.properties || {}, required = schema?.required || [];
    if (schema?.type !== 'object' || !Array.isArray(required) || /write|delete|execute|update|insert|remove/i.test(match[2])) continue;
    const action = /search|检索|搜索/i.test(match[2]) && properties.query?.type === 'string' && ['number', 'integer'].includes(properties.limit?.type) && required.every(k => ['query', 'limit'].includes(k)) ? 'search'
      : /read|fetch|get_document|读取/i.test(match[2]) && properties.id?.type === 'string' && required.every(k => k === 'id') ? 'read' : null;
    if (!action) continue;
    const group = groups.get(match[1]) || { search: [], read: [] }; group[action].push(tool); groups.set(match[1], group);
  }
  return [...groups.entries()].flatMap(([server, group]) => group.search.length === 1 && group.read.length === 1 ? [{ id: server, label: server.replace(/[_-]+/g, ' '), tools: { search: group.search[0].name, read: group.read[0].name } }] : []);
}
