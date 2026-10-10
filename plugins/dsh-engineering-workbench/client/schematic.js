    const newRequirement = () => ({ id: 'item-' + Math.random().toString(36).slice(2, 9), kind: 'component', ref: '', properties: { value: '' }, certain: false, evidence: { quote: '', page: 1 } });
    const blankContract = () => ({ schemaVersion: 1, scope: 'partial', requirements: [], unresolved: [] });
    function readContractDraft(text) {
      const c = JSON.parse(text);
      if (!c || c.schemaVersion !== 1 || c.scope !== 'partial' || !Array.isArray(c.requirements) || !Array.isArray(c.unresolved) || c.unresolved.some(s => typeof s !== 'string')) throw new Error('条目需要 schemaVersion:1、scope:partial、requirements 数组和 unresolved 字符串数组。');
      const ids = new Set();
      for (const r of c.requirements) {
        if (!r || typeof r.id !== 'string' || !r.id || ids.has(r.id) || !['component', 'absent', 'connected', 'disconnected'].includes(r.kind) || typeof r.certain !== 'boolean' || typeof r.evidence?.quote !== 'string') throw new Error('每个条目需要唯一 id、有效类型、certain 和 evidence.quote。');
        ids.add(r.id);
        if (['component', 'absent'].includes(r.kind) && typeof r.ref !== 'string') throw new Error('元件条目需要字符串位号 ref。');
        if (r.kind === 'component' && (!r.properties || Array.isArray(r.properties) || typeof r.properties !== 'object' || Object.entries(r.properties).some(([k, v]) => !['value', 'footprint', 'libId', 'dnp'].includes(k) || typeof v !== (k === 'dnp' ? 'boolean' : 'string')))) throw new Error('元件属性只接受 value、footprint、libId 字符串和 dnp 布尔值。');
        if (['connected', 'disconnected'].includes(r.kind) && (!Array.isArray(r.pins) || r.pins.some(p => !p || typeof p.ref !== 'string' || typeof p.pin !== 'string'))) throw new Error('连接条目需要 pins 数组，每个端点包含字符串 ref、pin。');
      }
      return c;
    }
    function targetDraft(text) {
      const contract = blankContract();
      for (const original of text.split(/[；;\n]+/)) {
        const quote = original.trim().replace(/[。.]$/, ''); if (!quote) continue;
        const value = quote.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(?:改为|修改为|设为|=|＝)\s*([A-Za-z0-9 .µμΩ%+\/-]+)$/);
        const fitted = quote.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*(不装|不装配|装配|安装)$/);
        if (value) contract.requirements.push({ ...newRequirement(), ref: value[1], properties: { value: value[2].trim() }, certain: true, evidence: { quote } });
        else if (fitted) contract.requirements.push({ ...newRequirement(), ref: fitted[1], properties: { dnp: fitted[2].startsWith('不') }, certain: true, evidence: { quote } });
        else contract.unresolved.push(quote);
      }
      return contract;
    }
    function ContractEditor({ value, onChange, imageTarget, disabled }) {
      const update = (i, patch) => onChange({ ...value, requirements: value.requirements.map((r, j) => i === j ? { ...r, ...patch } : r) });
      const kinds = [['component', '元件属性'], ['absent', '元件应不存在'], ['connected', '指定引脚连接'], ['disconnected', '两个引脚断开']];
      return h('div', null,
        value.requirements.map((row, i) => h('fieldset', { key: row.id, className: 'ew-target-row', disabled },
          h('legend', null, `检查条目 ${i + 1}`), h('div', { className: 'ew-form-row' },
            h(Field, { label: '检查类型' }, selectInput(row.kind, kind => update(i, { kind, ...(kind === 'component' ? { properties: { value: '' }, ref: row.ref || '' } : kind === 'absent' ? { ref: row.ref || '' } : { pins: [{ ref: '', pin: '' }, { ref: '', pin: '' }] }) }), kinds)),
            ['component', 'absent'].includes(row.kind) && h(Field, { label: '位号' }, textInput(row.ref || '', ref => update(i, { ref }), { placeholder: 'R1' })),
            ['connected', 'disconnected'].includes(row.kind) && h(Field, { label: '引脚端点（逗号分隔）' }, textInput((row.pins || []).map(p => p.ref + '.' + p.pin).join(', '), v => update(i, { pins: v.split(/[,，]/).map(s => { const a = s.trim().split('.'); return { ref: a[0] || '', pin: a.slice(1).join('.') }; }) }), { placeholder: 'U1.3, J1.2' })),
            row.kind === 'connected' && checkbox('只允许这些端点，无额外连接', !!row.exact, exact => update(i, { exact }))),
          row.kind === 'component' && h('div', { className: 'ew-form-row' }, Object.entries(row.properties || {}).map(([key, value]) => h('div', { className: 'ew-property', key }, key === 'dnp' ? checkbox('不装配（DNP）', value, v => update(i, { properties: { ...row.properties, dnp: v } })) : h(Field, { label: ({ value: '目标元件值', footprint: '目标封装', libId: '目标符号库 ID' })[key] || key }, textInput(value, v => update(i, { properties: { ...row.properties, [key]: v } }))), button('移除属性', () => update(i, { properties: Object.fromEntries(Object.entries(row.properties).filter(([k]) => k !== key)) }), { 'aria-label': '移除属性 ' + key }))),
            h(Field, { label: '添加属性' }, selectInput('', key => { if (key) update(i, { properties: { ...row.properties, [key]: key === 'dnp' ? false : '' } }); }, [['', '选择属性'], ...[['value', '元件值'], ['footprint', '封装'], ['libId', '符号库'], ['dnp', '装配状态']].filter(([k]) => !(k in (row.properties || {})))]))),
          h('div', { className: 'ew-form-row' }, h(Field, { label: imageTarget ? '可见证据描述' : '逐字原文依据' }, textInput(row.evidence?.quote || '', quote => update(i, { evidence: { ...row.evidence, quote } }))), imageTarget && h(Field, { label: '证据页码' }, h('input', { type: 'number', min: 1, value: row.evidence?.page || 1, onChange: e => update(i, { evidence: { ...row.evidence, page: Number(e.target.value) } }) })), checkbox('我已核对位号对应、数值和连接', row.certain, certain => update(i, { certain })), button('删除条目', () => onChange({ ...value, requirements: value.requirements.filter((_, j) => j !== i) }))))),
        button('添加目标条目', () => onChange({ ...value, requirements: [...value.requirements, newRequirement()] }), { disabled }),
        h(Field, { label: '尚未确认的事项（每行一项）' }, textarea(value.unresolved.join('\n'), text => onChange({ ...value, unresolved: text.split('\n').filter(x => x.trim()) }), { rows: 3, disabled })),
        h('p', { className: 'ew-help' }, '未确认条目和未解决事项会保留为未知，并阻止写回。文字依据必须逐字来自原文；图像依据需要实际读取对应页。'));
    }
    function Comparison({ value }) {
      if (!value) return null;
      return h('div', { className: 'ew-comparison' }, h('div', { className: 'ew-section-head' }, h('h3', null, value.matches ? '所列目标已满足' : '存在差异或待确认项'), chip(value.matches ? 'pass' : 'unknown')),
        h('p', { className: 'ew-help' }, value.scope === 'declared_requirements_only' ? '只核对明确列出的目标，不表示整张图纸等同。' : '原生目标同时核对实际网表与绘图结构。'),
        h(Table, { columns: [['检查内容', c => c.id || c.kind || c.field || '差异'], ['位置', c => c.ref || c.pins?.map(p => p.ref + '.' + p.pin).join('、') || c.net || '—'], ['状态', c => ({ match: '满足', difference: '有差异', unknown: '待确认' })[c.status] || c.kind || '差异'], ['要求 / 实际', c => h('div', null, c.properties && h('p', null, '目标：' + compact(c.properties)), c.expected !== undefined && h('p', null, '要求：' + compact(c.expected)), h('p', null, '实际：' + compact(c.actual ?? c.detail ?? c)))]], rows: value.checks || value.differences || [] }),
        h(Bullets, { items: value.unresolved }), value.unexpectedChanges?.length > 0 && h('div', { className: 'ew-error' }, '发现未在目标中声明的变化，不能写回。', h(Bullets, { items: value.unexpectedChanges })), h(Raw, { value, title: '完整网表与图形差异' }));
    }
    function SchematicChanges({ verification, reference }) {
      const data = verification.changeSet, changes = data?.changes || [];
      const [selected, setSelected] = useState(changes[0]?.id || ''), [showTarget, setShowTarget] = useState(false);
      const change = changes.find(c => c.id === selected);
      const panes = [['before', '修改前快照'], ['after', '候选副本']].map(([id, title]) => ({ id, title, view: verification.views[id], points: change?.[id]?.points, marks: (change ? [change] : changes).map(c => c[id]).filter(Boolean) }));
      if (showTarget && reference) panes.push({ id: 'target', title: '目标 JPG / PDF 原件', view: reference });
      return h('section', { className: 'ew-section', 'aria-label': '本次实际修改' },
        h('h3', null, data ? `本次实际变化：${data.counts.components} 个器件、${data.counts.wires} 段导线、${data.counts.other} 处标注 / 图形` : '请重新验证以生成实际修改清单'),
        h('p', { className: 'ew-help' }, '这里比较修改前与候选，目标检查结果列在下方。点击变化可在两侧分别定位；移动的器件按各自真实位置显示。'),
        changes.length ? h('div', { className: 'ew-change-list' }, button('查看全部变化', () => setSelected(''), { className: !selected ? 'ew-selected' : '' }), changes.map(c => button(h(R.Fragment, null, h('b', null, c.title), ...c.fields.map((f, i) => h('span', { key: i }, f.name + '：' + compact(f.before) + ' → ' + compact(f.after)))), () => setSelected(c.id), { key: c.id, className: selected === c.id ? 'ew-selected' : '', 'aria-pressed': selected === c.id }))) : h('p', { className: 'ew-note' }, '候选与修改前没有检测到可显示的变化。'),
        h('div', { className: 'ew-change-legend' }, h('span', { className: 'before' }, '橙色：修改前的位置 / 内容'), h('span', { className: 'after' }, '绿色：候选中的位置 / 内容')),
        change && (!change.before || !change.after) && h('p', { className: 'ew-help' }, !change.before ? '这是新增对象，修改前没有对应位置。' : '这是移除对象，候选中已不存在。'),
        reference && checkbox('同时对照目标原图', showTarget, setShowTarget),
        h(DrawingViewer, { title: '修改前后对比', panes, focusKey: selected }));
    }
    function Schematic() {
      const work = useWork();
      const [caps, setCaps] = useState(null), [current, setCurrent] = useState(''), [targetType, setTargetType] = useState('text'), [targetPath, setTargetPath] = useState(''), [targetText, setTargetText] = useState('');
      const [tasks, setTasks] = useState([]), [task, setTask] = useState(null), [target, setTarget] = useState(null), [page, setPage] = useState(1);
      const [contract, setContract] = useState(blankContract), [savedContract, setSavedContract] = useState(''), [contractJSON, setContractJSON] = useState('');
      const [inspection, setInspection] = useState(null), [which, setWhich] = useState('candidate'), [candidateRevision, setCandidateRevision] = useState(''), [comparison, setComparison] = useState(null), [verification, setVerification] = useState(null);
      const [operations, setOperations] = useState(''), [useOperations, setUseOperations] = useState(false), [notice, setNotice] = useState(''), [confirmation, setConfirmation] = useState(null), [closedProject, setClosedProject] = useState(false);
      const [focusRef, setFocusRef] = useState(''), [step, setStep] = useState('target');
      const listTasks = async () => setTasks(await api('tasks'));
      useEffect(() => { work.run('读取原理图工作区', async () => { setCaps(await invoke('schematic', 'capabilities')); const c = await api('bootstrap'); setCurrent(c.currentSchematic || ''); await listTasks(); }); }, []);
      const clearVerification = () => { setVerification(null); setConfirmation(null); setClosedProject(false); };
      const changeContract = v => { setContract(v); setContractJSON(JSON.stringify(v, null, 2)); clearVerification(); setComparison(null); };
      const inspect = async (id, selected = 'candidate') => { const v = await invoke('schematic', 'inspect', { taskId: id, which: selected }); setInspection(v); setWhich(selected); if (selected === 'candidate') setCandidateRevision(v.revision); return v; };
      const loadTask = id => work.run('载入原理图任务', async () => {
        if (!id) return;
        setOperations(''); setUseOperations(false); setFocusRef('');
        const t = await api('task?id=' + encodeURIComponent(id)); setTask(t); setTarget(null); setNotice(''); setInspection(null); setComparison(null); setCandidateRevision(''); clearVerification();
        const c = t.contract || blankContract(); setContract(c); setContractJSON(JSON.stringify(c, null, 2)); setSavedContract(t.contract ? JSON.stringify(c) : ''); setPage(1); setStep('target');
        if (!t.applied) { setTarget(await invoke('schematic', 'read', { taskId: id, page: 1 })); await inspect(id); }
        else setNotice(t.rolledBack ? '该任务已回退到写回前状态。' : '该任务已写回；可以核对写回信息并回退。');
      });
      const begin = () => work.run('保存当前图和目标的独立快照', async () => {
        setOperations(''); setUseOperations(false); setFocusRef(''); setCandidateRevision('');
        const x = await invoke('schematic', 'begin', { currentPath: current, ...(targetType === 'text' ? { targetText } : { targetPath }) });
        const t = await api('task?id=' + encodeURIComponent(x.taskId)); setTask(t); setComparison(null); setInspection(null); clearVerification(); setSavedContract(''); setNotice(''); setPage(1); setStep('target');
        const source = await invoke('schematic', 'read', { taskId: t.taskId, page: 1 }); setTarget(source);
        const c = source.kind === 'text' ? targetDraft(source.text) : blankContract(); setContract(c); setContractJSON(JSON.stringify(c, null, 2));
        await inspect(t.taskId); await listTasks();
      });
      const readTarget = interpret => work.run(interpret ? '正在识别图纸，通常需要 1–5 分钟' : '读取指定目标页', async () => {
        if (interpret) { const latest = await invoke('schematic', 'capabilities'); setCaps(latest); if (!latest.visionConfigured) throw new Error(latest.vision?.reason || '请先连接支持图片的 DSH 模型。'); }
        const v = await invoke('schematic', 'read', { taskId: task.taskId, page: Number(page), interpret }); setTarget(v);
        if (v.contract) { changeContract(readContractDraft(JSON.stringify(v.contract))); setNotice(`已识别 ${v.contract.requirements.length} 个检查条目、${v.contract.unresolved.length} 个待确认事项。请逐条确认目标位号与当前工程的对应关系，再勾选保存；原理图尚未修改。`); }
        else if (interpret) throw new Error(v.vision?.reason || v.instruction || '识别没有返回条目，请检查模型后重试。');
      });
      const define = () => work.run('保存带证据的目标条目', async () => { await invoke('schematic', 'define', { taskId: task.taskId, expectedTargetRevision: task.target.revision, contract }); setSavedContract(JSON.stringify(contract)); clearVerification(); setNotice('目标条目已保存，可以比较和修改候选。'); });
      const isNative = task?.target.kind === 'schematic';
      const contractReady = isNative || (savedContract && savedContract === JSON.stringify(contract));
      const compare = selected => work.run('核对原理图与目标', async () => { setComparison(await invoke('schematic', 'compare', { taskId: task.taskId, which: selected })); setStep('compare'); });
      const prepare = () => work.run('修改独立候选原理图', async () => {
        clearVerification();
        let ops;
        if (useOperations) { ops = JSON.parse(operations); if (!Array.isArray(ops) || !ops.length) throw new Error('高级修改操作必须为非空数组。'); }
        const v = await invoke('schematic', 'prepare', { taskId: task.taskId, expectedRevision: candidateRevision, ...(ops ? { operations: ops } : {}) });
        setCandidateRevision(v.revision); setComparison(null); setNotice(v.changed ? '候选副本已修改，请验证。原文件尚未写回。' : '候选与本次操作一致，没有产生变化。'); await inspect(task.taskId); setStep('candidate');
      });
      const verify = () => work.run('重新比较、运行 ERC 并生成前后图纸', async () => { clearVerification(); const v = await invoke('schematic', 'verify', { taskId: task.taskId }); setVerification(v); setComparison(v.comparison); setCandidateRevision(v.candidateHash); setStep('verify'); });
      const requestChange = action => work.run('核对本次工程修改', async () => { setClosedProject(false); setConfirmation(await api('confirmation', { action, taskId: task.taskId, ...(action === 'apply' ? { verificationToken: verification.token } : {}) })); });
      const confirmChange = () => work.run(confirmation.action === 'apply' ? '备份并写回工程' : '回退工程写回', async () => {
        const v = await invoke('schematic', confirmation.action, { taskId: task.taskId, ...(confirmation.action === 'apply' ? { verificationToken: verification.token } : {}) }, confirmation.id);
        const t = await api('task?id=' + encodeURIComponent(task.taskId)); setTask(t); setConfirmation(null); setClosedProject(false); setNotice(v.status === 'applied' ? '已备份并写回当前原理图。请在 KiCad 重新打开核对；PCB 没有随之修改。' : '已恢复写回前的原始文件。'); await listTasks();
      });
      const sourceImage = target?.artifacts?.find(a => a.key === 'preview');
      const referenceView = sourceImage && { url: sourceImage.url, width: target.preview.width || 1200, height: target.preview.height || 800 };
      const focus = inspection?.placements?.find(p => p.ref === focusRef);
      return h('div', { className: 'ew-business' },
        h('div', { className: 'ew-page-intro' }, h('div', null, h('h2', null, '原理图目标同步'), h('p', null, '读取目标、核对差异、修改独立候选，再验证和应用。')), h('small', null, caps?.allowApply ? '已启用验证后的受控写回' : '当前配置只允许候选修改与验证')),
        h(Alert, { work }), notice && h('p', { className: 'ew-notice', role: 'status' }, notice),
        h('section', { className: 'ew-paper' }, h('h3', null, '选择已有任务或创建新任务'),
          h('div', { className: 'ew-form-row' }, h(Field, { label: '已有原理图任务' }, selectInput(task?.taskId || '', loadTask, [['', '选择任务'], ...tasks.map(t => [t.taskId, `${t.current.split(/[\\/]/).pop()} · ${t.kind} · ${({ candidate: '候选', applied: '已写回', restored: '已回退' })[t.state]} · ${t.taskId.slice(0, 8)}`])], { disabled: !!work.busy })), button('刷新任务列表', () => work.run('刷新任务', listTasks), { disabled: !!work.busy })),
          h('details', { className: 'ew-extra', open: !task }, h('summary', null, '创建新任务'),
            h(FilePicker, { label: '当前原理图', value: current, onChange: setCurrent, extensions: ['.kicad_sch'] }),
            h(Field, { label: '目标类型' }, selectInput(targetType, setTargetType, [['text', '直接输入文字要求'], ['schematic', '目标 KiCad 原理图'], ['reference', '图片 / PDF'], ['document', 'TXT / Markdown 要求文件']])),
            targetType === 'text' ? h(Field, { label: '目标要求原文' }, textarea(targetText, setTargetText, { rows: 5, placeholder: '例如：R1 改为 10k；C1 改为 100nF；R9 不装。连接要求也可逐条录入并保留原文证据。', maxLength: 100000 })) : h(FilePicker, { label: '目标文件', value: targetPath, onChange: setTargetPath, extensions: targetType === 'schematic' ? ['.kicad_sch'] : targetType === 'reference' ? ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] : ['.txt', '.md'] }),
            button('创建并读取目标', begin, { className: 'ew-primary', disabled: !!work.busy || !current.trim() || !(targetType === 'text' ? targetText.trim() : targetPath.trim()) }))),
        task && h(R.Fragment, null,
          h('div', { className: 'ew-task-context' }, h('strong', null, '当前任务 ' + task.taskId.slice(0, 8)), h('span', null, task.current), h('small', null, `目标类型：${task.target.kind}。每个任务持有独立快照和候选。`)),
          !task.applied && h(R.Fragment, null,
            h('nav', { className: 'ew-subtabs ew-section', 'aria-label': '原理图任务步骤' }, [['target', '目标与证据'], ['compare', '差异比较'], ['candidate', '候选修改'], ['verify', '验证与写回']].map(([k, label]) => button(label, () => setStep(k), { key: k, className: step === k ? 'ew-selected' : '' }))),
            step === 'target' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '目标原件与检查条目'),
              ['pdf', 'image'].includes(task.target.kind) && h(R.Fragment, null, h('div', { className: 'ew-form-row' }, h(Field, { label: '目标页码' }, h('input', { type: 'number', min: 1, value: page, onChange: e => setPage(e.target.value) })), button('读取此页', () => readTarget(false), { disabled: !!work.busy }), button('识别本页为条目草稿', () => readTarget(true), { className: 'ew-primary', disabled: !!work.busy })), h('p', { className: 'ew-help' }, caps?.vision?.reason || '点击识别，将检查当前 DSH 模型是否支持图片。'), sourceImage && h('details', { className: 'ew-extra', open: !contract.requirements.length }, h('summary', null, '查看目标原图（点击展开 / 收起）'), h(DrawingViewer, { title: '目标原图', focusKey: sourceImage.url, panes: [{ id: 'target', title: `目标原件第 ${target.preview.page} 页`, view: referenceView }] })), target?.preview && h('details', null, h('summary', null, `第 ${target.preview.page} / ${target.preview.pages} 页可提取文字（不证明连线）`), h('pre', { className: 'ew-source-text' }, target.preview.text))),
              target?.kind === 'text' && h(R.Fragment, null, h('blockquote', { className: 'ew-source-text' }, target.text), button('从简单改值 / 装配要求提取草稿', () => { changeContract(targetDraft(target.text)); setNotice('仅提取明确的改值和装配语句，其他文字保留在待确认事项。请核对后保存。'); }, { disabled: !!work.busy })),
              isNative ? h('p', { className: 'ew-notice' }, '目标是原生 KiCad 图纸，直接比较实际网表及绘图结构，无需人工建立条目。') : h(R.Fragment, null,
                h(ContractEditor, { value: contract, onChange: changeContract, imageTarget: ['pdf', 'image'].includes(task.target.kind), disabled: !!work.busy }),
                h('details', { className: 'ew-extra' }, h('summary', null, '导入 / 编辑完整目标条目'), h(Field, { label: '目标条目 JSON' }, textarea(contractJSON, setContractJSON, { rows: 10, spellCheck: false })), button('载入条目草稿', () => { try { changeContract(readContractDraft(contractJSON)); } catch (e) { work.setError(e.message); } }, { disabled: !!work.busy })),
                button('保存并确认目标条目', define, { className: 'ew-primary', disabled: !!work.busy || !contract.requirements.length }), contractReady && h('span', { className: 'ew-help' }, '　当前条目已保存'))),
            step === 'compare' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '比较实际原理图与目标'), h('div', { className: 'ew-actions' }, button('比较修改前', () => compare('current'), { disabled: !!work.busy || !contractReady }), button('比较候选图', () => compare('candidate'), { disabled: !!work.busy || !contractReady, className: 'ew-primary' })), !contractReady && h('p', { className: 'ew-help' }, '请先保存目标条目。'), h(Comparison, { value: comparison })),
            step === 'candidate' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '候选图、器件与原始对象'),
              h('div', { className: 'ew-form-row' }, h(Field, { label: '查看图纸' }, selectInput(which, value => work.run('读取图纸与网络', () => inspect(task.taskId, value)), [['current', '修改前快照'], ['candidate', '候选副本'], ...(isNative ? [['target', '目标原图']] : [])])), button('读取图纸与对象', () => work.run('读取图纸与网络', () => inspect(task.taskId, which)), { disabled: !!work.busy })),
              inspection?.views?.sheet && h(DrawingViewer, { title: which === 'current' ? '修改前图纸' : which === 'target' ? '目标图纸' : '候选图纸', focusKey: inspection.revision + ':' + focusRef, panes: [{ id: which, title: which === 'current' ? '修改前快照' : which === 'target' ? '目标原图' : '候选副本', view: inspection.views.sheet, points: focus ? [focus.at.slice(0, 2)] : null, marks: focus ? [{ kind: 'symbol', points: [focus.at.slice(0, 2)] }] : [] }] }),
              inspection && h(R.Fragment, null, h(Field, { label: '聚焦器件' }, selectInput(focusRef, setFocusRef, [['', '整张图纸'], ...inspection.placements.map(p => [p.ref, `${p.ref} · ${p.value}`])])), h('details', { className: 'ew-extra' }, h('summary', null, '器件、网络与对象 UUID'), h(Table, { columns: [['位号', 'ref'], ['值', 'value'], ['封装', 'footprint'], ['不装配', c => c.dnp ? '是' : '否'], ['UUID', 'uuid']], rows: inspection.placements }), h(Raw, { value: inspection.board.nets, title: '逐脚网络' }), h(Raw, { value: inspection.objects, title: '原始图形与符号对象（高级修改依据）' }))),
              h('div', { className: 'ew-section-head' }, h('h3', null, '修改方式')), checkbox('使用高级修改操作（增删件、连线、图形、符号库）', useOperations, v => { setUseOperations(v); clearVerification(); }),
              useOperations ? h(Field, { label: '高级修改操作 JSON' }, textarea(operations, v => { setOperations(v); clearVerification(); }, { rows: 10, spellCheck: false, placeholder: '[{"op":"set_properties","ref":"R1","properties":{"Value":"10k"}}]' })) : h('p', { className: 'ew-help' }, isNative ? '自动同步单页原生目标，保留同位号元件关联。' : '按已保存的明确目标修改已有元件属性。连接和增删件需要基于实际 UUID 的高级操作。'),
              h('details', { className: 'ew-extra' }, h('summary', null, '支持的高级修改方式'), h(Bullets, { items: ['set_properties：按位号设置 Value、Footprint、dnp 等属性。', 'insert：插入完整对象 S-expression；replace：按 UUID 替换并保留 UUID；delete：按 UUID 删除。', 'upsert_library_symbol：新增或更新内嵌符号。连接修改必须依据实际引脚位置与网络，不能凭图面距离猜测。', '每次操作都绑定当前候选内容版本；修改后需要重新验证。'] })),
              button('修改候选副本', prepare, { disabled: !!work.busy || !candidateRevision || !contractReady, className: 'ew-primary' })),
            step === 'verify' && h('section', { className: 'ew-paper ew-section' }, h('div', { className: 'ew-section-head' }, h('h3', null, '验证、前后对比与写回'), button('验证候选并生成对比', verify, { disabled: !!work.busy || !contractReady, className: 'ew-primary' })),
              verification && h(R.Fragment, null,
                h('div', { className: 'ew-diff-summary' }, chip(verification.canApply ? 'pass' : 'unknown'), h('strong', null, `目标差异 ${verification.comparison.differences?.length || 0} 项`), h('span', null, `ERC：${verification.erc.errors} 个错误，${verification.erc.warnings} 个警告`)),
                h(SchematicChanges, { key: verification.token, verification, reference: referenceView }),
                h(Artifacts, { value: verification }), h(Comparison, { value: verification.comparison }),
                h('p', { className: 'ew-note' }, verification.canApply ? '所列目标满足且 ERC 无错误，可以核对后写回。警告仍需工程师复核。' : '目标差异、未知项或 ERC 错误尚未解决，写回不可用。'),
                button('核对并准备写回', () => requestChange('apply'), { disabled: !!work.busy || !verification.canApply || !caps?.allowApply, className: 'ew-primary' })))),
          task.applied && h('section', { className: 'ew-paper ew-section' }, h('h3', null, task.rolledBack ? '已回退' : '已写回'), h('p', { className: 'ew-wrap' }, '当前工程：', task.current), h('p', { className: 'ew-wrap' }, '原始备份：', task.applied.backup), h('p', null, '写回时间：', task.applied.appliedAt), !task.rolledBack && button('核对并准备回退', () => requestChange('rollback'), { disabled: !!work.busy })),
          confirmation && h('section', { className: 'ew-confirmation', role: 'region', 'aria-label': '确认工程修改' }, h('h3', null, confirmation.action === 'apply' ? '确认写回这一个原理图' : '确认恢复写回前版本'), h('p', { className: 'ew-wrap' }, confirmation.current), h('p', null, confirmation.warning), checkbox('我已保存并关闭该 KiCad 工程，并确认以上文件和修改', closedProject, setClosedProject), h('div', { className: 'ew-actions' }, button(confirmation.action === 'apply' ? '确认写回' : '确认回退', confirmChange, { disabled: !!work.busy || !closedProject, className: 'ew-primary' }), button('取消', () => setConfirmation(null), { disabled: !!work.busy })))),
        caps && h('details', { className: 'ew-extra' }, h('summary', null, '输入、修改与验证边界'), h(Bullets, { items: caps.rules })));
    }
