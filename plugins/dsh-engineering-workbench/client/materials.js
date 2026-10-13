    function MaterialBrowser({ onTask, disabled = false, onBusy, onSourceChange }) {
      const work = useWork(), [sources, setSources] = useState([]), [sourceId, setSourceId] = useState('megmeet-official'), [query, setQuery] = useState(''), [result, setResult] = useState(null);
      const [managing, setManaging] = useState(false), [localFile, setLocalFile] = useState(''), [pages, setPages] = useState([]), [managerBusy, setManagerBusy] = useState(false);
      const generation = useRef(0), resultHeading = useRef(null), manageTrigger = useRef(null), wasManaging = useRef(false);
      const load = async preferred => {
        const rows = await api('materials'); setSources(rows); setResult(null); setPages([]);
        setSourceId(previous => preferred || (previous === 'local-pdf' || rows.some(s => s.id === previous) ? previous : rows[0]?.id || 'local-pdf'));
      };
      const refresh = () => work.run('读取资料源', () => load());
      useEffect(() => { refresh(); }, []);
      useEffect(() => { onBusy?.(!!work.busy || managerBusy); return () => onBusy?.(false); }, [!!work.busy, managerBusy]);
      useEffect(() => { if (result) resultHeading.current?.focus(); }, [result]);
      useEffect(() => { if (managing) wasManaging.current = true; else if (wasManaging.current && !work.busy && !managerBusy && !disabled) { manageTrigger.current?.focus(); wasManaging.current = false; } }, [managing, work.busy, managerBusy, disabled]);
      const select = id => { generation.current++; setSourceId(id); setResult(null); setPages([]); work.setError(''); onSourceChange?.(); };
      const search = (cursor, history = []) => work.run('检索资料', async () => {
        const version = generation.current, next = await api('materials', { action: 'search', sourceId, query, limit: 20, ...(cursor ? { cursor } : {}) });
        if (version === generation.current) { setResult({ ...next, cursor }); setPages(history); }
      });
      const open = id => work.run('读取手册并建立任务', async () => {
        const version = generation.current, task = sourceId === 'local-pdf' ? await et({ action: 'create', kind: 'datasheet', left: localFile }) : await api('materials', { action: 'create-task', sourceId, id });
        if (version === generation.current) onTask(task);
      });
      const busy = disabled || !!work.busy || managerBusy, source = sources.find(s => s.id === sourceId);
      const choices = [...sources, { id: 'local-pdf', label: '本地 PDF', kind: 'local', connected: true }];
      return h('section', { className: 'ew-reference-card ew-material-browser', 'aria-label': '手册资料源', 'aria-busy': !!work.busy },
        h('div', { className: 'ew-section-head' }, h('div', null, h('h3', null, '选择手册来源'), h('p', { className: 'ew-help' }, '从官网查找、打开本地文件，或连接你的手册数据库。')), button('刷新资料源', refresh, { disabled: busy, className: 'ew-quiet' })),
        h(Alert, { work }),
        h('div', { className: 'ew-source-choices', role: 'group', 'aria-label': '资料来源' }, choices.map(s => button([
          h(Icon, { key: 'icon', name: s.kind === 'local' ? 'file' : s.kind === 'mcp' ? 'database' : 'globe', size: 22 }),
          h('span', { key: 'text' }, h('strong', null, s.kind === 'megmeet-official' ? '麦格米特官网' : s.label), h('small', null, s.kind === 'local' ? '选择工作区中的 PDF 手册' : s.coverage ? `${num(s.coverage.uniqueDocuments)} 份资料 · 官网下载索引` : s.connected ? '数据库已连接' : '待连接 · 可查看接入设置')),
          h('span', { className: 'ew-source-check', key: 'check', 'aria-hidden': true }, sourceId === s.id ? h(Icon, { name: 'check' }) : null),
        ], () => select(s.id), { key: s.id, className: 'ew-source-choice', 'aria-pressed': sourceId === s.id, disabled: busy })),
          button([h(Icon, { key: 'icon', name: 'plus', size: 22 }), h('span', { key: 'text' }, h('strong', null, '添加数据库资料源'), h('small', null, '接入只读 MCP，保留来源和版本'))], () => setManaging(!managing), { className: 'ew-source-choice ew-source-add', ref: manageTrigger, disabled: busy, 'aria-expanded': managing })),
        managing && h(MaterialSourceManager, { disabled: disabled || !!work.busy, onBusy: setManagerBusy, onClose: () => setManaging(false), onSaved: id => work.run('更新资料源', async () => { generation.current++; await load(id); setManaging(false); onSourceChange?.(); }) }),
        sourceId === 'local-pdf' ? h('div', { className: 'ew-source-content' },
          h(FilePicker, { label: 'PDF 手册', value: localFile, onChange: value => { setLocalFile(value); work.setError(''); onSourceChange?.(); }, extensions: ['.pdf'], disabled: busy }),
          h('div', { className: 'ew-action-row' }, h('p', { className: 'ew-help' }, '选择后读取文件，即可预览页面、提取参数并核对证据。'), button(work.busy || '读取手册并继续', () => open(), { className: 'ew-primary', disabled: busy || !localFile.trim() }))) : source && h('div', { className: 'ew-source-content' },
          !source.connected ? h('div', { className: 'ew-empty-action' }, h(Icon, { name: 'database', size: 28 }), h('strong', null, '资料源已保存，等待数据库连接'), h('p', null, '在 DeepSeek Harness 中连接对应 MCP 后，刷新资料源即可检索。'), button('查看接入设置', () => setManaging(true), { disabled: busy })) : h(R.Fragment, null,
            h('form', { className: 'ew-search-form', onSubmit: e => { e.preventDefault(); if (!busy) search(); } },
              h(Field, { label: '型号或手册关键词', hint: '留空可浏览全部资料，按 Enter 检索。' }, textInput(query, value => { generation.current++; setQuery(value); setResult(null); setPages([]); }, { disabled: busy, placeholder: '输入型号、系列或手册名称' })),
              h('button', { type: 'submit', className: 'ew-primary', disabled: busy }, work.busy === '检索资料' ? '正在检索…' : '检索手册')),
            !result && !work.busy && h('p', { className: 'ew-help' }, source.coverage ? `已收录官网 ${num(source.coverage.listedRows)} 条下载记录。PDF 可在工作台读取，其他格式请到官网下载。` : '按资料库实际结果分页展示，检索后选择一本手册继续。'))),
        result && h('div', { className: 'ew-material-results' },
          h('div', { className: 'ew-result-heading', ref: resultHeading, tabIndex: -1 }, h('strong', null, result.total == null ? `本页 ${result.items.length} 条资料` : `找到 ${num(result.total)} 条资料`), h('small', null, `第 ${pages.length + 1} 页 · 本页 ${result.items.length} 条`)),
          result.items.length ? h(Table, { columns: [['手册 / 资料', r => h('strong', null, r.title)], ['版本', r => r.revision || '未提供'], ['格式', r => h('span', { className: 'ew-format' }, (r.format || 'pdf').toUpperCase())], ['操作', r => r.format && r.format !== 'pdf' ? link('官网资料下载', r.officialPage) : button('读取此手册', () => open(r.id), { disabled: busy })]], rows: result.items }) : h('div', { className: 'ew-empty-action' }, h('strong', null, '没有找到匹配的资料'), h('p', null, '试试更短的型号或系列名，也可以清空关键词浏览全部。'), button('清空关键词', () => { setQuery(''); setResult(null); setPages([]); }, { disabled: busy })),
          h('div', { className: 'ew-pagination' }, button('上一页资料', () => search(pages.at(-1), pages.slice(0, -1)), { disabled: busy || !pages.length }), h('span', null, `第 ${pages.length + 1} 页`), button('下一页资料', () => search(result.nextCursor, [...pages, result.cursor]), { disabled: busy || !result.nextCursor }))));
    }

    function MaterialSourceManager({ onSaved, onClose, disabled, onBusy }) {
      const work = useWork(), [settings, setSettings] = useState(null), [editing, setEditing] = useState(''), [label, setLabel] = useState(''), [search, setSearch] = useState(''), [read, setRead] = useState(''), [readOnly, setReadOnly] = useState(false), [removing, setRemoving] = useState('');
      const listId = R.useId(), heading = useRef(null);
      const [advanced, setAdvanced] = useState(false), [connection, setConnection] = useState('');
      const refresh = () => work.run('读取接入设置', async () => setSettings(await api('material-sources')));
      useEffect(() => { refresh(); heading.current?.focus(); }, []);
      useEffect(() => { onBusy(!!work.busy); return () => onBusy(false); }, [!!work.busy]);
      const edit = s => { setAdvanced(true); setEditing(s.id); setLabel(s.label); setSearch(s.tools.search); setRead(s.tools.read); setReadOnly(true); setRemoving(''); work.setError(''); };
      const save = () => work.run('保存资料源', async () => { const result = await api('material-sources', { action: 'save-source', id: editing || undefined, source: { label, tools: { search, read }, readOnly } }); onSaved(result.id); });
      const busy = disabled || !!work.busy;
      return h('section', { className: 'ew-source-manager', 'aria-label': '资料源接入设置' },
        h('div', { className: 'ew-section-head' }, h('h4', { ref: heading, tabIndex: -1 }, '数据库接入设置'), button('收起接入设置', onClose, { disabled: busy, className: 'ew-quiet' })), h(Alert, { work }),
        !settings && !work.busy && button('重试读取设置', refresh),
        settings && h(R.Fragment, null,
          settings.sources.length > 0 && h('ul', { className: 'ew-managed-sources' }, settings.sources.map(s => h('li', { key: s.id }, h('span', null, h('strong', null, s.label), h('small', null, s.editable ? '工作台添加' : '由插件配置管理')), s.editable && h('div', { className: 'ew-inline' }, button('编辑', () => edit(s), { disabled: busy, 'aria-label': '编辑 ' + s.label }), removing === s.id ? h(R.Fragment, null, h('span', null, '仅移除连接配置，保留已读任务。'), button('确认移除', () => work.run('移除资料源', async () => { await api('material-sources', { action: 'remove-source', id: s.id }); onSaved(); }), { disabled: busy }), button('取消', () => setRemoving(''), { disabled: busy })) : button('移除', () => setRemoving(s.id), { disabled: busy, 'aria-label': '移除 ' + s.label }))))),
          h('p', { className: 'ew-help' }, settings.connections?.length ? '选择已连接的手册数据库，确认后即可添加到资料来源。' : '尚未发现可直接使用的手册数据库。'),
          !settings.connections?.length && h('ol', { className: 'ew-connect-steps' }, h('li', null, '在 DeepSeek Harness 设置中，连接管理员提供的手册数据库 MCP。'), h('li', null, '连接完成后，点击下方“重新检测数据库”。'), h('li', null, '选择检测到的数据库，添加后即可检索和阅读。')),
          button('重新检测数据库', refresh, { disabled: busy }),
          !!settings.connections?.length && h('div', { className: 'ew-source-choices' }, settings.connections.map(c => button(c.label, () => { setConnection(c.id); setLabel(c.label); setSearch(c.tools.search); setRead(c.tools.read); setReadOnly(true); setEditing(''); }, { key: c.id, className: 'ew-source-choice', 'aria-pressed': connection === c.id, disabled: busy }))),
          !advanced && !connection && !editing && button('高级接入（管理员配置）', () => setAdvanced(true), { className: 'ew-quiet', disabled: busy }),
          (advanced || connection || editing) && h('form', { onSubmit: e => { e.preventDefault(); if (!busy) save(); } },
            h(Field, { label: '资料源名称' }, textInput(label, setLabel, { required: true, maxLength: 120, disabled: busy, placeholder: '例如：公司器件手册库' })),
            h('details', { open: advanced, onToggle: e => setAdvanced(e.currentTarget.open) }, h('summary', null, '高级接入（管理员配置）'),
            h('div', { className: 'ew-form-row' }, h(Field, { label: '检索工具', hint: '接收 query、limit 和可选 cursor。' }, textInput(search, setSearch, { required: true, pattern: 'mcp__[a-zA-Z0-9_\\-]{1,200}', list: listId, disabled: busy, placeholder: 'mcp__manuals__search' })), h(Field, { label: '读取工具', hint: '接收 id，返回工作区中的 PDF 路径。' }, textInput(read, setRead, { required: true, pattern: 'mcp__[a-zA-Z0-9_\\-]{1,200}', list: listId, disabled: busy, placeholder: 'mcp__manuals__read' }))),
            h('datalist', { id: listId }, settings.tools.map(t => h('option', { key: t.name, value: t.name }, t.description))),
            checkbox('这两个工具仅用于检索和读取资料', readOnly, setReadOnly, { required: true, disabled: busy }),
            h('details', null, h('summary', null, '查看数据库适配接口'), h('p', { className: 'ew-help' }, '检索返回 { items: [{ id, title, revision? }], total?, nextCursor? }；读取返回 { id, title, revision?, filePath }。filePath 为工作区内 PDF 的绝对路径。数据库凭证在 DeepSeek Harness 的 MCP 配置中管理。'))),
            !settings.canSave && h('p', { className: 'ew-error' }, '请先在插件设置中配置工作目录，才能保存资料源。'),
            h('div', { className: 'ew-action-row' }, h('p', { className: 'ew-help' }, connection ? '将此数据库作为只读手册资料源。资料格式不兼容时会说明原因。' : '由管理员填写适配接口；保存后会显示实际连接状态。'), h('button', { type: 'submit', className: 'ew-primary', disabled: busy || !settings.canSave || !label.trim() || !search || !read || !readOnly }, editing ? '保存修改' : '保存资料源')))));
    }
