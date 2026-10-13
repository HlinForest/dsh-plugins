import fs from 'node:fs/promises';
import path from 'node:path';
import { within, json } from './engineering/io.js';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readOfficialIndex, readOfficialDocument } from './official-materials.js';
import { discoverMaterialConnections } from './material-connections.js';
const require = createRequire(import.meta.url);

// Adapter tools expose a small read-only contract. Credentials stay in DSH's MCP configuration.
export class Materials {
  constructor(service, tools) { this.service = service; this.tools = tools; this.writes = Promise.resolve(); }
  validateSource(source) {
    if (!source || !/^[a-zA-Z0-9_-]{1,80}$/.test(source.id) || typeof source.label !== 'string' || !source.label.trim() || source.label.length > 120 || source.kind !== 'mcp' || source.readOnly !== true || !['search', 'read'].every(action => /^mcp__[a-zA-Z0-9_-]{1,200}$/.test(source.tools?.[action] || ''))) throw new Error('请填写资料源名称，以及只读 MCP 的检索和读取工具名称。');
    return { id: source.id, label: source.label.trim(), kind: 'mcp', readOnly: true, tools: { search: source.tools.search, read: source.tools.read } };
  }
  async readConfig(file, optional = false) {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('资料源配置必须是小于 1 MiB 的 JSON 文件。');
      const config = JSON.parse(await fs.readFile(file, 'utf8'));
      if (config.schemaVersion !== 1 || !Array.isArray(config.sources)) throw new Error('资料源配置格式无效。');
      return config.sources.map(s => this.validateSource(s));
    } catch (error) { if (optional && error.code === 'ENOENT') return []; throw error; }
  }
  get userFile() { return this.service.config.workDirectory ? path.join(this.service.config.workDirectory, 'material-sources.user.json') : null; }
  async settings() {
    const sources = (await this.sources()).filter(s => s.kind === 'mcp');
    const tools = this.tools.schemas().filter(t => /^mcp__/.test(t.name)).map(t => ({ name: t.name, description: (t.description || '').slice(0, 300) }));
    return { sources, tools, connections: discoverMaterialConnections(this.tools.schemas()), canSave: !!this.userFile };
  }
  async configure(input) {
    const operation = this.writes.then(async () => {
      if (!this.userFile) throw new Error('请先为工作台配置工作目录。');
      const existing = (await this.sources()).find(s => s.id === input.id);
      if (input.id && (!existing || !existing.editable)) throw new Error('此资料源由插件配置管理，不能在工作台中修改。');
      const rows = await this.readConfig(this.userFile, true);
      let saved;
      if (input.action === 'save-source') {
        saved = this.validateSource({ ...input.source, id: input.id || `manuals-${randomUUID()}`, kind: 'mcp' });
        if (!input.id && rows.length >= 100) throw new Error('最多添加 100 个资料源。');
      } else if (input.action !== 'remove-source' || !input.id) throw new Error('请选择要移除的资料源。');
      const next = rows.filter(s => s.id !== input.id);
      if (saved) next.push(saved);
      await this.service.init(); await json(this.userFile, { schemaVersion: 1, sources: next });
      return { id: saved?.id || null };
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async sources() {
    const builtins = [];
    try { builtins.push({ id: 'megmeet-official', label: '麦格米特官网全部下载资料', kind: 'megmeet-official', readOnly: true, indexPath: require.resolve('dsh-megmeet/official-downloads') }); }
    catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error; }
    const file = this.service.config.materialSourcesPath;
    const configured = file ? (await this.readConfig(file)).map(s => ({ ...s, editable: false })) : [];
    const user = this.userFile ? (await this.readConfig(this.userFile, true)).map(s => ({ ...s, editable: true })) : [];
    const ids = new Set(builtins.map(s => s.id));
    return [...builtins, ...[...configured, ...user].map(source => {
      if (ids.has(source.id)) throw new Error('资料源 ID 重复，请检查配置。');
      ids.add(source.id);
      return source;
    })];
  }
  async list() {
    const available = new Set(this.tools.schemas().map(t => t.name));
    return Promise.all((await this.sources()).map(async ({ tools, indexPath, ...source }) => ({ ...source, connected: source.kind === 'megmeet-official' || Object.values(tools).every(name => available.has(name)), ...(indexPath ? { coverage: (await readOfficialIndex(indexPath)).coverage } : {}) })));
  }
  async call(sourceId, action, args, signal) {
    signal?.throwIfAborted();
    const source = (await this.sources()).find(s => s.id === sourceId);
    if (!source) throw new Error('请选择已配置的资料源。');
    const name = source.tools[action];
    if (!this.tools.schemas().some(t => t.name === name)) throw new Error(`资料源“${source.label}”尚未连接；请先在 DSH 中接入对应 MCP。`);
    const result = await this.tools.execute(name, args, signal);
    signal?.throwIfAborted();
    // Native adapters may return a value, MCP adapters structuredContent or one JSON text block.
    let value = result?.structuredContent ?? result;
    if (value?.content && !value.items && !value.id) {
      const texts = value.content.filter(c => c.type === 'text');
      if (texts.length !== 1) throw new Error('资料 MCP 需返回约定的结构化 JSON。');
      try { value = JSON.parse(texts[0].text); } catch { throw new Error('资料 MCP 返回的内容不是有效 JSON。'); }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('资料 MCP 响应格式无效。');
    return { source, value };
  }
  async search(input, signal) {
    if (typeof input.query !== 'string' || input.query.length > 2000 || !Number.isInteger(input.limit ?? 20) || (input.limit ?? 20) < 1 || (input.limit ?? 20) > 100 || input.cursor != null && (typeof input.cursor !== 'string' || input.cursor.length > 4096)) throw new Error('请输入有效检索词、页大小或游标。');
    const limit = input.limit ?? 20;
    const official = (await this.sources()).find(s => s.id === input.sourceId && s.kind === 'megmeet-official');
    if (official) {
      const index = await readOfficialIndex(official.indexPath), query = input.query.trim().toLowerCase();
      const rows = index.items.filter(row => [row.title, ...row.titles, ...row.models].some(text => text.toLowerCase().includes(query)));
      const offset = input.cursor ? Number(input.cursor) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > rows.length) throw new Error('资料分页已失效，请重新检索。');
      return { sourceId: official.id, items: rows.slice(offset, offset + limit).map(row => ({ ...this.metadata(row), format: row.format, models: row.models, officialPage: row.officialPage })), total: rows.length, nextCursor: offset + limit < rows.length ? String(offset + limit) : null };
    }
    const { source, value } = await this.call(input.sourceId, 'search', { query: input.query, limit, ...(input.cursor ? { cursor: input.cursor } : {}) }, signal);
    if (!Array.isArray(value.items) || value.items.length > limit || value.total != null && (!Number.isSafeInteger(value.total) || value.total < value.items.length) || value.nextCursor != null && (typeof value.nextCursor !== 'string' || value.nextCursor.length > 4096)) throw new Error('资料 MCP 分页结果格式无效。');
    const ids = new Set();
    const items = value.items.map(item => { this.validateRecord(item); if (ids.has(item.id)) throw new Error('资料 MCP 本页记录 ID 重复。'); ids.add(item.id); return this.metadata(item); });
    return { sourceId: source.id, items, total: value.total ?? null, nextCursor: value.nextCursor || null };
  }
  validateRecord(value) {
    if (typeof value.id !== 'string' || !value.id.trim() || value.id.length > 1000 || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 2000 || value.revision != null && typeof value.revision !== 'string') throw new Error('资料 MCP 记录需明确 ID、标题及有效版本。');
  }
  metadata(value) { return { id: value.id, title: value.title, revision: value.revision ?? null }; }
  async read(input, signal) {
    if (typeof input.id !== 'string' || !input.id.trim() || input.id.length > 1000) throw new Error('请选择有效的资料记录。');
    const official = (await this.sources()).find(s => s.id === input.sourceId && s.kind === 'megmeet-official');
    if (official) {
      const index = await readOfficialIndex(official.indexPath), item = index.items.find(row => row.id === input.id);
      if (!item) throw new Error('官网资料记录不存在，请刷新索引。');
      const record = await readOfficialDocument(item, this.service.config, signal);
      return { ...this.metadata(item), ...record, sourceId: official.id, sourceLabel: official.label, retrievedAt: new Date().toISOString() };
    }
    const { source, value } = await this.call(input.sourceId, 'read', { id: input.id }, signal);
    this.validateRecord(value);
    if (value.id !== input.id) throw new Error('资料 MCP 返回了不同的记录。');
    if (typeof value.filePath !== 'string' || path.extname(value.filePath).toLowerCase() !== '.pdf') throw new Error('资料 MCP 适配器需将 PDF 保存到已配置工作区并返回 filePath。');
    const filePath = await within(this.service.config.workspaceRoot, value.filePath);
    if (!(await fs.stat(filePath)).isFile()) throw new Error('资料记录对应的 PDF 文件不存在。');
    return { ...this.metadata(value), sourceId: source.id, sourceLabel: source.label, filePath, retrievedAt: new Date().toISOString() };
  }
}
