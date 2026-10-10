    const engineeringTitles = { datasheet: '读手册', selection: '产品方案', 'schematic-review': '原理图评审', 'pcb-review': 'PCB 评审', compare: '原理图对比', align: '向目标对齐' };
    const engineeringStatus = { pass: '已列条件符合', fail: '发现差异 / 问题', unknown: '待确认', not_performed: '未执行', warning: '发现警告', failed: '检查失败', suggestions: '扩展检查建议', different: '有差异', ready: '已建立任务' };
    const es = value => engineeringStatus[value] || value || '—';
    const et = body => api('engineering', body);
    function Engineering({ kind, requestedTask }) {
      const work = useWork(), [left, setLeft] = useState(''), [right, setRight] = useState(''), [output, setOutput] = useState('');
      const [task, setTask] = useState(null), [records, setRecords] = useState([]), [chosen, setChosen] = useState([]), [focus, setFocus] = useState('');
      const [relatedSchematic, setRelatedSchematic] = useState('');
      const [native, setNative] = useState(true), [extended, setExtended] = useState(true), [checks, setChecks] = useState([]), [metrics, setMetrics] = useState([]);
      const pair = kind === 'compare' || kind === 'align', review = kind.endsWith('review');
      const refreshList = async () => setRecords((await et({ action: 'list' })).filter(t => t.kind === kind));
      useEffect(() => { api('bootstrap').then(c => setLeft(kind === 'pcb-review' ? c.pcbPath || '' : kind !== 'datasheet' ? c.currentSchematic || '' : '')).catch(() => {}); refreshList().catch(() => {}); }, []);
      const execute = (action, extra = {}) => work.run('正在' + ({ create: '读取文件', review: '评审', extract: '提取并交叉核对', prepare: '生成候选', verify: '验证候选', export: '保存报告' }[action] || '处理任务'), async () => {
        const result = await et({ action, taskId: task?.id, revision: task?.revision, ...extra }); setTask(result); setChosen([]); if (action === 'create' || action === 'open') setFocus(''); await refreshList(); return result;
      });
      const current = task?.candidate || task?.left;
      const source = current?.design, target = task?.right?.design;
      const diffNames = { value: '数值', footprint: '封装', dnp: '装配状态', libId: '型号 / 符号', position: '图面位置', 'pin-net': '引脚连接', 'net-name-only': '仅网络名不同', 'mapping-unconfirmed': '对应关系待确认', 'unmatched-source': '源图未匹配', 'unmatched-target': '目标图未匹配' };
      const describeObject = id => [...(source?.components || []), ...(target?.components || [])].find(c => c.id === id)?.ref || id;
      const selectTask = async id => { if (!id) return; const result = await execute('open', { taskId: id }); if (result) { setLeft(result.left.source); setRight(result.right?.source || ''); setOutput(result.outputDirectory || ''); setChecks(result.checks || []); setMetrics(result.metrics || []); } };
      useEffect(() => { if (requestedTask) selectTask(requestedTask); }, [requestedTask]);
      const issueObject = row => {
        const identities = [...(row.objects || []), ...(row.items || []).map(x => x.uuid), ...(row.components || [])];
        return source?.components.find(c => identities.some(id => [c.id, c.uuid, c.ref].includes(typeof id === 'string' ? id : id?.ref) || c.pins?.some(p => p.uuid === id)))?.id;
      };
      const confirmation = operation => work.run('复核文件版本', async () => {
        const prepared = await et({ action: 'confirmation', taskId: task.id, operation });
        const message = operation === 'apply' ? '已经查看实际元件、连接和图形变化。保存并关闭 EDA 后，确认覆盖原工程？系统会保留备份，PCB 需另行更新。' : '确认从此任务的备份回退？后续人工改动不会被覆盖。';
        if (window.confirm(message)) setTask(await et({ action: operation, taskId: task.id, confirmation: prepared.confirmation }));
      });
      return h('div', { className: 'ew-engineering' },
        h('div', { className: 'ew-section-head' }, h('div', null, h('h2', null, engineeringTitles[kind]), h('p', { className: 'ew-help' }, '每项任务拥有独立文件快照、检查范围和记录。默认工程仅用于预填。')), h('div', null, task && chip('版本 ' + task.revision))),
        h(Alert, { work }),
        h('div', { className: 'ew-form-row' }, h(FilePicker, { label: pair ? '源原理图' : kind === 'datasheet' ? 'PDF 手册' : '待评审工程', value: left, onChange: setLeft, extensions: kind === 'datasheet' ? ['.pdf'] : kind === 'pcb-review' ? ['.kicad_pcb', '.pcbdoc'] : undefined }), pair && h(FilePicker, { label: '目标原理图 / 图片 / PDF', value: right, onChange: setRight }), h(Field, { label: '报告保存目录（可留空）' }, textInput(output, setOutput, { placeholder: '留空则保存在此任务目录' }))),
        kind === 'pcb-review' && h('details', null, h('summary', null, '可选：关联原理图以执行原生一致性检查'), h(FilePicker, { label: '关联原理图（留空继续评审 PCB）', value: relatedSchematic, onChange: setRelatedSchematic, extensions: ['.kicad_sch'] })),
        h('div', { className: 'ew-inline' }, button('新建独立任务', () => execute('create', { kind, left, right: pair ? right : undefined, relatedSchematic: relatedSchematic || undefined, outputDirectory: output || undefined }), { disabled: !!work.busy || !left || pair && !right }), h(Field, { label: '打开已有记录' }, selectInput(task?.id || '', selectTask, [['', '选择此任务的记录'], ...records.map(t => [t.id, `${t.label} · ${new Date(t.createdAt).toLocaleString()}`])]))),
        task && h(R.Fragment, null,
          h('p', { className: 'ew-help' }, '任务 ' + task.id + ' · ' + task.left.source),
          (!task.sourceFresh && !task.applied || task.targetFresh === false || task.candidateFresh === false) && h('p', { className: 'ew-error' }, '源工程、目标或候选已在此任务之外改变。旧结果只用于查看历史，不能沿用旧确认覆盖文件。'),
          h('div', { className: 'ew-inline' }, button('导出报告 / 资料卡', () => execute('export')), task.candidate && button('验证候选', () => execute('verify')), task.validation?.canOverwrite && button('覆盖原工程', () => confirmation('apply')), task.applied && button('回退此版本', () => confirmation('rollback'))), h(Artifacts, { value: task }),
          task.validation && h('div', { className: task.validation.canOverwrite ? 'ew-note' : 'ew-error' }, '原生检查：' + es(task.validation.native.status) + '。' + (task.validation.native.reason || '') + (task.validation.canOverwrite ? '允许确认保存。' : '当前不能覆盖原工程；可保留候选继续处理。') + ' 修改原理图不会自动更新 PCB。'),
          ['left', ...(pair ? ['right'] : [])].map(side => task[side].design.format === 'reference' && h(ReferencePanel, { key: side, task, side, execute, work })),
          source?.previews?.length > 0 && h(EngineeringViewer, { task, focus }),
          kind === 'pcb-review' && h(BoardObjects, { design: source, focus }),
          review && h(R.Fragment, null,
            h('h3', null, '检查范围'), h('div', { className: 'ew-inline' }, checkbox('原生 ERC / DRC', native, setNative), checkbox('扩展检查建议', extended, setExtended), button('开始评审', () => execute('review', { native, extended, checks }), { disabled: !!work.busy })),
            h(RuleEditor, { value: checks, onChange: setChecks, components: source.components, nets: source.nets }),
            task.review && h(R.Fragment, null, h('h3', null, '检查结果'), h('p', null, '原生：' + es(task.review.native.status) + ' · 扩展：' + es(task.review.extension.status)), h(Bullets, { items: task.review.missing }),
              task.review.native.reason && h('p', { className: 'ew-error' }, task.review.native.reason), task.review.extension.reason && h('p', { className: 'ew-note' }, task.review.extension.reason),
              h(Table, { columns: [['检查项', r => r.rule || r.type || r.description || r.detector], ['结论', r => es(r.status || r.severity)], ['证据 / 描述', r => r.reason || r.description || r.summary || r.formula], ['位置', r => (r.objects || r.items || r.components || []).map(x => typeof x === 'string' ? describeObject(x) : x.description || x.uuid).join(', ')], ['定位', r => button('定位器件', () => setFocus(issueObject(r)), { disabled: !issueObject(r) })]], rows: [...(task.review.native.violations || []), ...task.review.rules, ...(task.review.extension.findings || [])] }))),
          pair && h(R.Fragment, null,
            h('h3', null, '元件对应关系'), h('p', { className: 'ew-help' }, '位号相同只是建议。不同型号、不同引脚定义需逐项核对；不能据此认定可互换。'),
            h(MappingEditor, { task, onSave: mappings => execute('mapping', { mappings }) }),
            kind === 'align' && h(LayoutCalibration, { task, execute }),
            h(FunctionEditor, { value: metrics, onChange: setMetrics }),
            button('比较元件、连接和功能指标', () => execute('compare', { metrics }), { disabled: !!work.busy }),
            task.comparison && h(R.Fragment, null,
              h('div', { className: 'ew-conclusions' }, [['components', '元件匹配'], ['connectivity', '连接相同'], ['functional', '已列功能指标一致'], ['requirements', '已列设计要求满足']].map(([key, title]) => h('article', { key }, h('small', null, title), h('strong', null, es(task.comparison.conclusions[key]))))),
              h('p', { className: 'ew-help' }, '完整电路功能等价：未验证。图面位置差异不直接视为电气或功能差异。'),
              h(Table, { columns: [['选择', d => checkbox('', chosen.includes(d.id), yes => setChosen(yes ? [...chosen, d.id] : chosen.filter(x => x !== d.id)))], ['层次 / 差异', d => `${d.layer} · ${diffNames[d.kind] || d.kind}`], ['对象', d => button(d.objects.map(describeObject).join(' ↔ '), () => setFocus(d.objects[0]))], ['源 → 目标', d => `${compact(d.before)} → ${compact(d.after)}`], ['状态', d => es(d.status)]], rows: task.comparison.differences }),
              h(Table, { columns: [['指标', r => r.id], ['源', r => `${r.left.value ?? '未知'} ${r.left.unit}`], ['目标', r => `${r.right.value ?? '未知'} ${r.right.unit}`], ['一致性', r => es(r.status)], ['满足要求', r => es(r.requirements)]], rows: task.comparison.functional })),
            kind === 'align' && h(R.Fragment, null,
              h('div', { className: 'ew-inline' }, button('将所选差异对齐到目标', () => execute('prepare', { differences: chosen }), { disabled: !chosen.length || !!work.busy }), h('small', null, '未选择的差异继续保留；未知数值不猜填。')),
              task.manualDifferences?.length > 0 && h('p', { className: 'ew-note' }, '候选已建立。所选连接、型号或引脚差异需要在下方编辑器中逐项调整；再次比较和验证后才能保存。'),
              h(GraphicEditor, { key: task.id, design: source, focus, task, execute, work }),
              task.actualChanges?.length > 0 && h(R.Fragment, null, h('h3', null, '实际修改记录'), h(Table, { columns: [['对象', c => c.id], ['变化', c => c.kind], ['定位', c => button('在图中查看', () => setFocus(c.id))]], rows: task.actualChanges }))))));
    }
    function EngineeringViewer({ task, focus }) {
      const [leftPage, setLeftPage] = useState(0), [rightPage, setRightPage] = useState(0);
      const design = (task.candidate || task.left).design, other = task.right?.design;
      const parts = [design, other].filter(Boolean), pages = [leftPage, rightPage], setters = [setLeftPage, setRightPage];
      useEffect(() => { if (!focus) return; parts.forEach((d, i) => { const id = i ? task.mappings.find(m => m.left === focus)?.right : focus; const c = [...d.components, ...d.objects].find(c => c.id === id); const page = d.previews.findIndex(p => p.document === c?.document); if (page >= 0) setters[i](page); }); }, [focus, task.id]);
      const marks = (side, document) => (task.actualChanges || []).map(c => c[side]).filter(o => o && o.document === document && (o.at?.length || o.points?.length)).map(o => ({ kind: o.kind, points: o.points?.length ? o.points : [o.at] }));
      const panes = parts.map((d, i) => { const view = d.previews[Math.min(pages[i], d.previews.length - 1)]; const mapped = i ? task.mappings.find(m => m.left === focus)?.right : focus; const c = d.components.find(c => c.id === mapped); return view && { id: i ? 'target' : 'after', title: i ? '目标资料' : task.candidate ? '修改候选' : '源工程', view, marks: !i && d.format === 'kicad' ? marks('after', view.document) : [], points: d.format === 'kicad' && c?.at && c.document === view.document ? [c.at] : undefined }; }).filter(Boolean);
      if (task.candidate && task.left.design.previews[0]) { const view = task.left.design.previews[Math.min(leftPage, task.left.design.previews.length - 1)], c = task.left.design.components.find(c => c.id === focus); panes.unshift({ id: 'before', title: '修改前', view, marks: task.left.design.format === 'kicad' ? marks('before', view.document) : [], points: task.left.design.format === 'kicad' && c?.document === view.document ? [c.at] : undefined }); }
      return h('section', null, h('div', { className: 'ew-inline' }, parts.map((d, i) => d.previews.length > 1 && h(Field, { key: i, label: i ? '目标页' : '源工程页' }, selectInput(String(pages[i]), s => setters[i](Number(s)), d.previews.map((p, j) => [String(j), p.name || `第 ${j + 1} 页`]))))), h(DrawingViewer, { panes, focusKey: focus + ':' + leftPage + ':' + rightPage + ':' + task.revision, title: '原图与修改候选 · 同步缩放' }));
    }
    function BoardObjects({ design, focus }) {
      const [selected, setSelected] = useState([]), [show, setShow] = useState(false);
      const part = design.components.find(c => selected.includes(c.ref));
      useEffect(() => { const c = design.components.find(c => c.id === focus); if (c) { setSelected([c.ref]); setShow(true); } }, [focus]);
      return h('section', null, button(show ? '收起器件与网络' : '器件定位与实际焊盘网络', () => setShow(!show)), show && h(R.Fragment, null,
        h(PositionMap, { components: design.components, selected, onSelect: setSelected }), h('p', { className: 'ew-help' }, '此图显示封装参考点。铜皮间距、未布线和制造规则由原生 DRC 检查；参考点距离不用于判断电气间隙。'),
        part && h('div', { className: 'ew-refbox' }, h('strong', null, part.ref + ' · ' + part.footprint), button('取消选择', () => setSelected([])), h(Table, { columns: [['焊盘', p => p.number], ['实际网络', p => design.nets.filter(n => n.nodes.some(x => x.component === part.id && x.pin === p.number)).map(n => n.name).join(', ') || '无网络']], rows: part.pins }))));
    }
    function EngineeringMaterials({ onOpen }) {
      const work = useWork(), [records, setRecords] = useState([]);
      const refresh = () => work.run('读取资料与任务', async () => setRecords(await et({ action: 'list' })));
      useEffect(() => { refresh(); }, []);
      return h('section', null, h('h2', null, '资料管理'), h('p', { className: 'ew-help' }, '各任务保留自己的源文件快照、证据和报告。打开记录可查看资料卡、导出或继续处理；选择文件时仍需明确本次任务输入。'), h(Alert, { work }), button('刷新记录', refresh), h(Table, { columns: [['名称', r => r.label], ['任务', r => engineeringTitles[r.kind]], ['创建时间', r => new Date(r.createdAt).toLocaleString()], ['版本', r => r.revision], ['打开', r => button('打开此记录', () => onOpen(r.kind, r.id))]], rows: records }));
    }
    function MappingEditor({ task, onSave }) {
      const [rows, setRows] = useState(task.mappings);
      useEffect(() => setRows(task.mappings), [task.revision, task.id]);
      const update = (i, patch) => setRows(rows.map((m, j) => i === j ? { ...m, ...patch } : m));
      return h('div', null, h(Table, { columns: [['源器件', (m) => (task.candidate || task.left).design.components.find(c => c.id === m.left)?.ref || m.left], ['目标器件', (m, i) => selectInput(m.right, right => update(i, { right, confirmed: false }), [['', '未对应'], ...task.right.design.components.map(c => [c.id, `${c.ref} · ${c.value || '未知值'} · ${c.document}`])])], ['对应确认', (m, i) => checkbox('已核对', m.confirmed, confirmed => update(i, { confirmed }))], ['引脚对应（源:目标）', (m, i) => textInput(Object.entries(m.pins || {}).map(([a,b]) => a + ':' + b).join(', '), text => { const pins = {}; for (const pair of text.split(',')) { const [a,b] = pair.split(':').map(s => s.trim()); if (a && b) pins[a] = b; } update(i, { pins, confirmed: false }); }, { placeholder: '空白使用相同引脚号' })]], rows }), button('保存对应关系', () => onSave(rows)));
    }
    function LayoutCalibration({ task, execute }) {
      const [a, setA] = useState(''), [b, setB] = useState(''), [flipY, setFlipY] = useState((task.left.design.format === 'altium') !== (task.right.design.format === 'altium'));
      const choices = [['', '选择已核对的对应器件'], ...task.mappings.filter(m => m.confirmed && m.right).map(m => [m.left, task.left.design.components.find(c => c.id === m.left)?.ref || m.left])];
      return h('details', null, h('summary', null, '图面坐标校准（图片、PDF 和跨格式对齐时使用）'), h('p', { className: 'ew-help' }, '选择两个器件作为固定位置，目标图其余器件按这两个位置换算缩放和方向。不能直接把图片像素当成工程毫米。'), h('div', { className: 'ew-inline' }, h(Field, { label: '第一个锚点' }, selectInput(a, setA, choices)), h(Field, { label: '第二个锚点' }, selectInput(b, setB, choices)), checkbox('翻转目标纵坐标方向', flipY, setFlipY), button('校准目标图面', () => execute('calibrate', { anchors: [a,b], flipY }), { disabled: !a || !b || a === b })), task.calibration && h('p', { className: 'ew-note' }, `已校准，缩放系数 ${task.calibration.scale.toFixed(5)}；更改器件对应关系后需重新校准。`));
    }
    function ReferencePanel({ task, side, execute, work }) {
      const snap = task[side], design = snap.design, [page, setPage] = useState(String(design.page || 1)), [text, setText] = useState(''), [reviewed, setReviewed] = useState(false);
      useEffect(() => { setText(snap.draft ? JSON.stringify(snap.draft.first, null, 2) : ''); setReviewed(false); }, [snap.draft?.sourceHash, snap.draft?.page, snap.draft?.first, design.page]);
      return h('section', { className: 'ew-reference-card' }, h('h3', null, side === 'right' ? '目标资料识别' : task.kind === 'datasheet' ? '资料卡' : '源资料识别'),
        h('div', { className: 'ew-inline' }, h(Field, { label: `页码 / 共 ${design.pages} 页` }, textInput(page, setPage, { type: 'number', min: 1, max: design.pages })), button('读取此页', () => execute('page', { side, page: Number(page) })), button('提取两遍并核对', () => execute('extract', { side }), { disabled: !!work.busy })),
        snap.draft && h('p', { className: 'ew-note' }, snap.draft.crossCheck === 'agree' ? '两次识别一致，仍未人工确认。' : '两次识别有差异，请核对原图。'),
        h('details', null, h('summary', null, '本页文字'), h('pre', { className: 'ew-reference-text' }, design.text || '此页无文本层，可使用图像识别。')),
        h('details', { open: !!text }, h('summary', null, '校对 / 导入结构化条目（每项保留页码、原文和图中位置）'), h('textarea', { value: text, onChange: e => setText(e.target.value), rows: 12, 'aria-label': '识别条目' }), checkbox('我已对照本页核对这些条目', reviewed, setReviewed), button('保存本页条目', () => { try { execute('evidence', { side, data: JSON.parse(text), reviewed }); } catch { work.setError('条目不是有效 JSON，请修正后保存。'); } }, { disabled: !text || !!work.busy })),
        task.kind === 'datasheet' && h(Table, { columns: [['参数 / 引脚', x => x.name || x.pin], ['数值', x => x.value], ['条件', x => x.conditions], ['出处', x => `第 ${x.page} 页 · ${x.quote}`], ['核对状态', x => x.verification === 'human-reviewed' ? '人工已核对' : '待确认']], rows: task.evidence }));
    }
    const ruleInputs = { divider: ['vin', 'rTop', 'rBottom'], rc: ['r', 'c'], current: ['vin', 'vf', 'r'], power: ['current', 'r'], ldo: ['vin', 'vout', 'current'], 'voltage-domain': ['driverMin', 'driverMax', 'receiverMin', 'receiverMax'] };
    const ruleLabels = { divider: '分压', rc: 'RC 截止频率', current: '限流', power: '电阻功耗', ldo: 'LDO 功耗', 'voltage-domain': '电压域', decoupling: '去耦', pullup: '上拉' };
    function MetricFields({ value, onChange }) {
      return h('div', { className: 'ew-form-row' }, h(Field, { label: '计算项' }, selectInput(value.kind || 'divider', kind => onChange({ ...value, kind, inputs: {} }), Object.entries(ruleLabels).filter(([k]) => ruleInputs[k]))), (ruleInputs[value.kind || 'divider'] || []).map(key => h(Field, { key, label: key + '（V / A / Ω / F，支持 10k、100n）' }, textInput(String(value.inputs?.[key] ?? ''), x => onChange({ ...value, inputs: { ...value.inputs, [key]: x } })))), h(Field, { label: '适用工况' }, textInput(value.conditions || '', conditions => onChange({ ...value, conditions }))), h(Field, { label: '参数出处 / 测量依据' }, textInput(value.evidence?.[0]?.quote || '', quote => onChange({ ...value, evidence: quote ? [{ quote, verification: 'user-supplied' }] : [] }))), h(Field, { label: '允许最小值（可空）' }, textInput(String(value.min ?? ''), min => onChange({ ...value, min: min === '' ? undefined : Number(min) }))), h(Field, { label: '允许最大值（可空）' }, textInput(String(value.max ?? ''), max => onChange({ ...value, max: max === '' ? undefined : Number(max) }))));
    }
    function FunctionEditor({ value, onChange }) {
      return h('details', null, h('summary', null, '功能指标与工况（可选；留空则不判断功能一致）'), value.map((row, i) => h('fieldset', { key: row.id }, h('legend', null, row.id), h('h4', null, '源图'), h(MetricFields, { value: row.left, onChange: left => onChange(value.map((r,j) => i === j ? { ...r, left } : r)) }), h('h4', null, '目标图'), h(MetricFields, { value: row.right, onChange: right => onChange(value.map((r,j) => i === j ? { ...r, right } : r)) }), button('删除指标', () => onChange(value.filter((_,j) => i !== j))))), button('增加一个指标', () => onChange([...value, { id: '指标 ' + (value.length + 1), left: { kind: 'divider', inputs: {} }, right: { kind: 'divider', inputs: {} }, tolerance: .000001 }])));
    }
    function RuleEditor({ value, onChange, components, nets }) {
      return h('details', null, h('summary', null, '扩展规则与工况依据（可选）'), value.map((row, i) => { const update = next => onChange(value.map((r,j) => i === j ? next : r)); return h('fieldset', { key: row.id }, h('legend', null, row.id), h(Field, { label: '规则' }, selectInput(row.kind, kind => update({ id: row.id, kind, inputs: {} }), Object.entries(ruleLabels))), ['decoupling', 'pullup'].includes(row.kind) ? h('div', { className: 'ew-form-row' }, h(Field, { label: '器件' }, selectInput(row.component || '', component => update({ ...row, component }), [['', '请选择'], ...components.map(c => [c.id, `${c.ref} · ${c.document}`])])), ...['pin', 'returnNet'].map(k => h(Field, { key: k, label: k === 'pin' ? '引脚号' : '另一端网络名（地或上拉电源）' }, k === 'returnNet' ? selectInput(row[k] || '', v => update({ ...row, [k]: v }), [['', '选择完整网络名'], ...(nets || []).map(n => [n.name,n.name])]) : textInput(row[k] || '', v => update({ ...row, [k]: v })))), h(Field, { label: '手册或规则依据' }, textInput(row.evidence?.[0]?.quote || '', quote => update({ ...row, evidence: quote ? [{ quote }] : [] })))) : h(MetricFields, { value: row, onChange: update }), button('删除规则', () => onChange(value.filter((_,j) => j !== i)))); }), button('添加检查项', () => onChange([...value, { id: '规则 ' + (value.length + 1), kind: 'divider', inputs: {} }])));
    }
    function GraphicEditor({ design, focus, task, execute, work }) {
      const [keepConnections, setKeepConnections] = useState(true), [newRef, setNewRef] = useState(''), [newValue, setNewValue] = useState(''), [template, setTemplate] = useState(''), [pinsConfirmed, setPinsConfirmed] = useState(false), [library, setLibrary] = useState(''), [symbolName, setSymbolName] = useState('');
      const [selected, setSelected] = useState([]), [search, setSearch] = useState(''), [mode, setMode] = useState('select'), [start, setStart] = useState(null), [zoom, setZoom] = useState(1), [full, setFull] = useState(false), [documentId, setDocumentId] = useState(design.documents[0]?.id), [label, setLabel] = useState(''), [propertyValue, setPropertyValue] = useState(''), [propertyKey, setPropertyKey] = useState('Value');
      const svg = useRef(null), drag = useRef(null), [box, setBox] = useState(null), [viewCenter, setViewCenter] = useState(null);
      const parts = design.components.filter(c => c.document === documentId), objects = design.objects.filter(o => o.document === documentId);
      const points = [...parts.map(c => c.at), ...objects.flatMap(o => o.points || [])].filter(p => p?.length >= 2);
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]), minx = Math.min(...xs, 0) - 10, miny = Math.min(...ys, 0) - 10;
      const width = Math.max(80, Math.max(...xs, 80) - minx + 10), height = Math.max(60, Math.max(...ys, 60) - miny + 10);
      const selectedPart = parts.find(c => selected.includes(c.id)), center = viewCenter || [minx + width / 2, miny + height / 2];
      const viewBox = `${center[0] - width / zoom / 2} ${center[1] - height / zoom / 2} ${width / zoom} ${height / zoom}`;
      const coords = e => { const point = svg.current.createSVGPoint(); point.x = e.clientX; point.y = e.clientY; const p = point.matrixTransform(svg.current.getScreenCTM().inverse()); return [Math.round(p.x / 1.27) * 1.27, Math.round(p.y / 1.27) * 1.27]; };
      const edit = operations => execute('edit', { operations, grid: 1.27 });
      useEffect(() => { if (focus) { setSelected([focus]); const c = design.components.find(c => c.id === focus); if (c) { setDocumentId(c.document); setViewCenter(c.at); setZoom(3); } } }, [focus]);
      useEffect(() => { setSelected([]); setViewCenter(null); setZoom(1); setDocumentId(design.documents[0]?.id); }, [task.id]);
      useEffect(() => { if (selectedPart) setPropertyValue(propertyKey === 'Value' ? selectedPart.value || '' : propertyKey === 'Footprint' ? selectedPart.footprint || '' : selectedPart.properties?.Datasheet || ''); }, [selectedPart?.id, propertyKey, task.revision]);
      const down = e => {
        if (work.busy || e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); const p = coords(e), id = e.target.closest('[data-object]')?.getAttribute('data-object');
        if (mode === 'wire') { if (start) { edit([{ op: 'wire', from: start, to: p, document: documentId }]); setStart(null); } else setStart(p); return; }
        if (mode === 'label' || mode === 'junction') { edit([{ op: mode, at: p, text: label, document: documentId }]); return; }
        if (id) { const selection = e.shiftKey ? [...new Set([...selected, id])] : selected.includes(id) ? selected : [id]; setSelected(selection); drag.current = { at: p, selection }; }
        else { setSelected([]); drag.current = { at: p, selection: [], box: true }; setBox({ a: p, b: p }); }
        svg.current.setPointerCapture(e.pointerId);
      };
      const up = e => {
        const d = drag.current; drag.current = null; if (!d) return; const p = coords(e);
        if (d.box) { setSelected(parts.filter(c => c.at[0] >= Math.min(p[0], d.at[0]) && c.at[0] <= Math.max(p[0], d.at[0]) && c.at[1] >= Math.min(p[1], d.at[1]) && c.at[1] <= Math.max(p[1], d.at[1])).map(c => c.id)); setBox(null); }
        else if (p[0] !== d.at[0] || p[1] !== d.at[1]) { const ops = parts.filter(c => d.selection.includes(c.id)).map(c => ({ op: 'move', id: c.id, disconnect: !keepConnections, at: [c.at[0] + p[0] - d.at[0], c.at[1] + p[1] - d.at[1]] })); if (ops.length) edit(ops); }
      };
      return h('section', { className: 'ew-graphic-editor' + (full ? ' ew-drawing-full' : ''), onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); setSelected([]); setStart(null); setBox(null); setFull(false); } } },
        h('h3', null, '对齐差异编辑器'), h('p', { className: 'ew-help' }, '点击选择，空白处框选，拖动器件保持连接。导线点击两端绘制；旋转后请验证实际连接。对象按原生坐标显示，完整符号外观请查看上方原图。'),
        h('div', { className: 'ew-inline' }, h(Field, { label: '页面' }, selectInput(documentId, id => { setDocumentId(id); setSelected([]); setViewCenter(null); setZoom(1); }, design.documents.map(d => [d.id, d.id + (d.instances > 1 ? '（重复实例，禁止自动写入）' : '')]))), textInput(search, setSearch, { placeholder: '搜索位号' }), button('定位', () => { const c = design.components.find(c => c.ref.toLowerCase() === search.toLowerCase()); if (c) { setDocumentId(c.document); setSelected([c.id]); setViewCenter(c.at); setZoom(4); } }), button(full ? '退出全屏' : '全屏编辑', () => setFull(!full)), button('−', () => setZoom(Math.max(.5, zoom / 1.4))), button('+', () => setZoom(Math.min(15, zoom * 1.4))), button('适合窗口', () => { setZoom(1); setSelected([]); setViewCenter(null); })),
        h('div', { className: 'ew-inline' }, ...[['select','选择 / 移动'], ['wire','绘制导线'], ['junction','连接点'], ['label','网络标注']].map(([key,title]) => button(title, () => { setMode(key); setStart(null); }, { className: mode === key ? 'ew-selected' : '' })), mode === 'label' && textInput(label, setLabel, { placeholder: '网络名称' }), button('旋转 90°', () => edit(selected.map(id => ({ op: 'rotate', id }))), { disabled: !selected.length }), button('删除所选对象', () => edit(selected.map(id => ({ op: 'delete', id }))), { disabled: !selected.length }), button('撤销', () => execute('undo'), { disabled: !task.canUndo }), button('重做', () => execute('redo'), { disabled: !task.canRedo })),
        h('svg', { ref: svg, className: 'ew-edit-canvas', viewBox, tabIndex: 0, 'aria-label': '原生对象编辑画布', onPointerDown: down, onPointerUp: up, onPointerMove: e => { if (drag.current?.box) setBox({ a: drag.current.at, b: coords(e) }); }, onPointerCancel: () => { drag.current = null; setBox(null); }, onWheel: e => { setZoom(z => Math.max(.5, Math.min(15, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))); } },
          objects.filter(o => o.points?.length).map(o => h('polyline', { key: o.id, 'data-object': o.id, points: o.points.map(p => p.join(',')).join(' '), fill: 'none', stroke: selected.includes(o.id) ? '#b87527' : '#287357', strokeWidth: selected.includes(o.id) ? .7 : .3, style: { cursor: 'pointer' }, pointerEvents: 'stroke' })),
          objects.filter(o => o.at && /junction|label/i.test(o.kind)).map(o => h('circle', { key: o.id, 'data-object': o.id, cx: o.at[0], cy: o.at[1], r: .7, fill: selected.includes(o.id) ? '#b87527' : '#287357' })),
          parts.map(c => h('g', { key: c.id, 'data-object': c.id, style: { cursor: 'move' } }, h('rect', { x: c.at[0] - 3, y: c.at[1] - 2, width: 6, height: 4, fill: selected.includes(c.id) ? '#ffe3a5' : '#fffdf3', stroke: selected.includes(c.id) ? '#b87527' : '#294652', strokeWidth: .25 }), h('text', { x: c.at[0], y: c.at[1] - 3, fontSize: 1.7, textAnchor: 'middle' }, c.ref + ' ' + (c.value || '待确认')), c.pins?.map((pin, i) => pin.at && h('circle', { key: i, cx: pin.at[0], cy: pin.at[1], r: .35, fill: '#a74135' }, h('title', null, pin.number + ' ' + pin.name))))),
          box && h('rect', { x: Math.min(box.a[0], box.b[0]), y: Math.min(box.a[1], box.b[1]), width: Math.abs(box.b[0] - box.a[0]), height: Math.abs(box.b[1] - box.a[1]), fill: '#32849622', stroke: '#328496', strokeWidth: .3 }), start && h('circle', { cx: start[0], cy: start[1], r: 1, fill: '#b87527' })),
        h('div', { className: 'ew-inline' }, h('span', null, selected.length ? `已选 ${selected.length} 个对象` : '未选择'), selectInput(propertyKey, setPropertyKey, [['Value','数值'], ['Footprint','封装'], ['Datasheet','手册链接']]), textInput(propertyValue, setPropertyValue, { placeholder: '属性值' }), button('修改所选器件属性', () => edit(selected.map(id => ({ op: 'properties', id, properties: { [propertyKey]: propertyValue } }))), { disabled: !selectedPart }), button('取消选择', () => { setSelected([]); setBox(null); setStart(null); }), checkbox('拖动保持连接（取消即显式断开）', keepConnections, setKeepConnections)),
        h('details', null, h('summary', null, '新增器件（明确符号与引脚定义）'),
          design.format === 'kicad' ? h(R.Fragment, null, h(Field, { label: '复用源工程中的完整符号' }, selectInput(template, id => { setTemplate(id); setPinsConfirmed(false); }, [['', '选择已有符号'], ...task.left.design.components.map(c => [c.id, `${c.ref} · ${c.libId}`])])), h('p', { className: 'ew-help' }, '引脚定义：' + (task.left.design.components.find(c => c.id === template)?.pins.map(p => p.number + ':' + p.name).join(', ') || '请选择符号'))) : h(R.Fragment, null, h(FilePicker, { label: 'AD 符号库 SchLib', value: library, onChange: setLibrary, extensions: ['.schlib'] }), h(Field, { label: '库内准确符号名' }, textInput(symbolName, setSymbolName))),
          h('div', { className: 'ew-inline' }, h(Field, { label: '新位号' }, textInput(newRef, setNewRef)), h(Field, { label: '已知数值（缺值留空，待确认）' }, textInput(newValue, setNewValue)), checkbox('已核对符号和引脚定义', pinsConfirmed, setPinsConfirmed), button('在视图中心新增', () => edit([{ op: design.format === 'kicad' ? 'add-from-component' : 'add-component', side: 'source', template, library, symbolName, ref: newRef, value: newValue, pinsConfirmed, at: center.map(x => Math.round(x / 1.27) * 1.27), document: documentId }]), { disabled: !newRef || !pinsConfirmed || design.format === 'kicad' && !template || design.format === 'altium' && (!library || !symbolName) }))));
    }
