    const kindNames = { mcu: '单片机', adc: 'ADC', isolator: '隔离器件', mosfet: 'MOSFET', regulator: '稳压器', crystal: '晶体 / 晶振', connector: '连接器', capacitor: '电容', resistor: '电阻', diode: '二极管', opamp: '运放', generic: '通用器件' };
    function Findings({ report, onSelect }) {
      if (!report) return null;
      return h('section', null, h('div', { className: 'ew-section-head' }, h('h3', null, report.conclusion), h('small', null, `${report.summary.warning} 项需处理，${report.summary.unknown} 项待确认`)),
        h('div', { className: 'ew-findings-list' }, report.findings.map(f => h('article', { key: f.id, className: 'ew-finding' }, h('div', null, chip(f.status), h('strong', null, f.title)), h('p', null, f.details), h('p', { className: 'ew-help' }, '依据：', f.basis), h('div', { className: 'ew-inline' }, f.refs.map(ref => button(ref, () => onSelect?.([ref]), { key: ref, disabled: !onSelect, 'aria-label': '定位检查器件 ' + ref })), f.net && h('small', null, '网络：' + f.net))))),
        h('details', { className: 'ew-extra' }, h('summary', null, '本次检查范围'), h(Bullets, { items: [report.coverage.connectivity, report.coverage.placement, report.coverage.isolation, '未检查：' + report.coverage.notChecked.join('、'), ...(report.notes || [])] })));
    }
    function PCB() {
      const work = useWork();
      const [caps, setCaps] = useState(null), [tab, setTab] = useState('project'), [inspection, setInspection] = useState(null), [report, setReport] = useState(null), [visual, setVisual] = useState(null), [view, setView] = useState('positions'), [selected, setSelected] = useState([]);
      const [ref, setRef] = useState(''), [detail, setDetail] = useState(null), [netFilter, setNetFilter] = useState(''), [exported, setExported] = useState(null);
      const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [guide, setGuide] = useState(null);
      const [snapshot, setSnapshot] = useState(''), [snapshotResult, setSnapshotResult] = useState(null);
      const [watch, setWatch] = useState(null), [popup, setPopup] = useState(false), [seconds, setSeconds] = useState(3);
      const [queryBusy, setQueryBusy] = useState(false), [queryError, setQueryError] = useState('');
      const queryVersion = useRef(0);
      useEffect(() => () => { queryVersion.current++; }, []);
      const loadProject = async () => { const i = await invoke('pcb', 'inspect'); const r = await invoke('pcb', 'review'); setInspection(i); setReport(r); setExported(null); };
      useEffect(() => { work.run('读取评审配置', async () => { const c = await invoke('pcb', 'capabilities'); setCaps(c); if (c.configuredProject) await loadProject(); }); }, []);
      useEffect(() => {
        if (tab !== 'watch') return;
        let stopped = false, initialized = false;
        const tick = async () => { try { const v = await invoke('pcb', 'watch'); if (!stopped) { setWatch(v); if (!initialized) { setPopup(!!v.settings?.popup); setSeconds(v.settings?.pollSeconds || 3); initialized = true; } } } catch (e) { if (!stopped) work.setError(e.message); } };
        if (!document.hidden) tick(); const stop = visiblePoll(tick, 4000); return () => { stopped = true; stop(); };
      }, [tab]);
      const inspectRef = async value => {
        const requested = value.trim(), version = ++queryVersion.current;
        setRef(requested); setSelected(requested ? [requested] : []); setDetail(null); setQueryError(''); setQueryBusy(true);
        try {
          const x = await invoke('pcb', 'inspect', requested ? { ref: requested } : {});
          if (version !== queryVersion.current) return;
          if (x.component) { setDetail(x); setSelected([x.component.ref]); } else setInspection(x);
        } catch (e) { if (version === queryVersion.current) setQueryError(e.message); }
        finally { if (version === queryVersion.current) setQueryBusy(false); }
      };
      const locate = refs => {
        if (view === 'pcb') setView('positions');
        if (refs[0]) inspectRef(refs[0]);
        else { queryVersion.current++; setSelected([]); setRef(''); setDetail(null); setQueryBusy(false); setQueryError(''); }
      };
      const updateProject = () => work.run('从已保存工程更新网表与图纸', async () => { const v = await api('refresh-project', {}); setVisual(v); await loadProject(); });
      const setWatcher = enabled => work.run(enabled ? '开启快照监听' : '停止快照监听', async () => { setWatch(await invoke('pcb', 'setWatch', { enabled, popup, pollSeconds: Number(seconds) })); });
      const components = visual?.components || inspection?.components || [];
      return h('div', { className: 'ew-business' },
        h('div', { className: 'ew-page-intro' }, h('div', null, h('h2', null, 'PCB 与原理图评审'), h('p', null, '从器件清单、实际网表和项目规则核对问题。')), caps && h('small', { className: 'ew-wrap' }, caps.configuredProject || '尚未配置默认工程')),
        h('nav', { className: 'ew-subtabs', 'aria-label': 'PCB 评审功能' }, [['project', '工程与网络'], ['guide', '器件检查清单'], ['snapshot', '输入快照评审'], ['watch', '变更监听']].map(([k, title]) => button(title, () => setTab(k), { key: k, className: tab === k ? 'ew-selected' : '', 'aria-pressed': tab === k }))),
        h(Alert, { work }),
        tab === 'project' && h(R.Fragment, null,
          h('div', { className: 'ew-actions' }, button('重新评审导出项目', () => work.run('读取并评审项目', loadProject), { disabled: !!work.busy || !caps?.configuredProject }), button('从已保存 KiCad 工程更新', updateProject, { disabled: !!work.busy || !caps?.configuredProject, className: 'ew-primary' }), report && button('导出评审报告', () => work.run('导出评审报告', async () => setExported(await invoke('pcb', 'export', { expectedRevision: report.revision }))), { disabled: !!work.busy || !caps?.reportExportEnabled })),
          h('p', { className: 'ew-help' }, '评审读取已导出快照；更新按钮会重新导出已保存的 KiCad 工程，并更新评审快照。未保存编辑不在检查范围内。'),
          h(Artifacts, { value: exported }),
          inspection && h('div', { className: 'ew-inspection-grid' },
            h('section', { className: 'ew-paper' }, h('div', { className: 'ew-section-head' }, h('h3', null, inspection.project), h('small', null, `${inspection.counts.components} 个器件，${inspection.counts.nets} 个网络`)),
              h('div', { className: 'ew-subtabs' }, [['positions', '器件定位'], ['pcb', 'PCB 原图'], ['schematic', '原理图']].map(([k, label]) => button(label, () => setView(k), { key: k, className: view === k ? 'ew-selected' : '', disabled: k !== 'positions' && !visual }))),
              h('div', { className: 'ew-board-canvas ew-section' }, view === 'positions' ? h(PositionMap, { components, selected, onSelect: locate }) : view === 'pcb' ? h('img', { src: visual.pcb, alt: 'KiCad 导出的真实 PCB 铜层与丝印' }) : h(Sheet, { view: visual.schematic, parts: visual.placements, selected })),
              h('p', { className: 'ew-help' }, view === 'positions' ? '封装参考点位置，不代表焊盘和铜皮；点击器件查询引脚网络，点击空白处或按 Esc 取消选择。' : '原生 KiCad 导出图纸。多页原理图当前预览首张，可在同步页检查网表。'),
              h(Alert, { work: { busy: queryBusy ? '查询器件网络' : '', error: queryError } }),
              h('div', { className: 'ew-form-row' }, h(Field, { label: '精确位号' }, textInput(ref, setRef, { placeholder: '例如 U1' })), button('查询器件网络', () => inspectRef(ref), { disabled: !!work.busy || queryBusy })),
              detail && h('div', { className: 'ew-refbox' }, h('h3', null, detail.component.ref + ' · ' + detail.component.value), h('p', null, '封装：' + (detail.component.footprint || '未提供')), h(Table, { columns: [['网络', 'name'], ['连接端点', n => n.nodes.map(p => p.ref + '.' + p.pin).join('、')]], rows: detail.nets }), h(Raw, { value: detail.component, title: '装配状态、属性与坐标' }))),
            h('section', { className: 'ew-paper' }, h('h3', null, '网络与器件目录'), h(Field, { label: '筛选网络名称' }, textInput(netFilter, setNetFilter)), h(Table, { columns: [['网络', 'name'], ['引脚数', 'pinCount']], rows: inspection.nets.filter(n => n.name.toLowerCase().includes(netFilter.toLowerCase())) }),
              h('details', { className: 'ew-extra' }, h('summary', null, '器件目录'), h(Table, { columns: [['位号', c => button(c.ref, () => locate([c.ref]), { disabled: !!work.busy })], ['值', 'value'], ['封装', 'footprint']], rows: inspection.components })), inspection.truncated && h('p', { className: 'ew-help' }, '总览最多显示 200 项，请按位号查询具体器件。'))),
          report && h('section', { className: 'ew-paper ew-section' }, h(Findings, { report, onSelect: locate }))),
        tab === 'guide' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '按器件查询检查清单'),
          h('div', { className: 'ew-form-row' }, h(Field, { label: '器件型号或用途' }, textInput(query, setQuery, { placeholder: '例如 STM32、隔离芯片、输入滤波电容' })), h(Field, { label: '器件类别' }, selectInput(kind, setKind, [['', '按名称推测'], ...(caps?.kinds || Object.keys(kindNames)).map(k => [k, kindNames[k] || k])])), button('查询检查清单', () => work.run('查询器件检查清单', async () => setGuide(await invoke('pcb', 'guide', { query, ...(kind ? { kind } : {}) }))), { className: 'ew-primary', disabled: !!work.busy || !query.trim() })),
          guide ? h(R.Fragment, null, h('p', { className: 'ew-note' }, guide.classification, '。', guide.note), h(Table, { columns: [['类别', 'category'], ['需检查的内容', 'check'], ['检查位置', 'location'], ['依据', c => c.basis.title]], rows: guide.checks }), h('h3', { className: 'ew-section-title' }, '需补充资料'), h(Bullets, { items: guide.requiredInputs })) : empty('选择类别或输入具体器件，查看原理图、布局、走线、工艺和安规检查位置。')),
        tab === 'snapshot' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '评审调用者提供的快照'), h('p', { className: 'ew-help' }, '适用于 AD / KiCad 导出后整理的统一数据。结果会保留“调用者提供”的来源标记。'),
          h(Field, { label: '快照 JSON（board 与 context）' }, textarea(snapshot, v => { setSnapshot(v); setSnapshotResult(null); }, { rows: 12, spellCheck: false, placeholder: '{"board":{…},"context":{…}}' })),
          button('评审输入快照', () => work.run('评审输入快照', async () => { JSON.parse(snapshot); setSnapshotResult(await invoke('pcb', 'snapshot', { snapshotJson: snapshot })); }), { className: 'ew-primary', disabled: !!work.busy || !snapshot.trim() }), snapshotResult && h(R.Fragment, null, h(Findings, { report: snapshotResult }), h('details', { className: 'ew-extra' }, h('summary', null, '完整评审文本'), h(TextReport, { text: snapshotResult.markdown })))),
        tab === 'watch' && h('section', { className: 'ew-paper ew-section' }, h('h3', null, '导出快照变化监听'), h('p', { className: 'ew-help' }, '两次读取稳定后提示新增或变化的问题。监测的是导出文件；请先保存并重新导出设计。设置作用于当前 DSH 运行会话，重启恢复原配置。'),
          h('div', { className: 'ew-form-row' }, h(Field, { label: '检查间隔（秒）' }, h('input', { type: 'number', value: seconds, min: 1, max: 3600, onChange: e => setSeconds(e.target.value) })), checkbox('显示本机 Windows 提醒', popup, setPopup), button('开启 / 更新监听', () => setWatcher(true), { disabled: !!work.busy, className: 'ew-primary' }), button('停止监听', () => setWatcher(false), { disabled: !!work.busy || !watch?.settings?.enabled })),
          watch && h(R.Fragment, null, h('p', { role: 'status' }, '状态：', ({ disabled: '未开启', starting: '启动中', settling: '等待数据稳定', watching: '正在监听', error: '读取失败', stopped: '已停止' })[watch.state] || watch.state, '　最近检查：', stamp(watch.lastCheckedAt)), watch.lastError && h('div', { className: 'ew-error' }, watch.lastError), h(Table, { columns: [['状态', f => chip(f.status)], ['检查项', 'title'], ['位置', f => f.refs.join('、')], ['说明', 'details']], rows: watch.findings || [] }))),
        caps && h('details', { className: 'ew-extra' }, h('summary', null, '支持范围与配置'), h(Bullets, { items: caps.checks }), h(Bullets, { items: caps.limits }), h(Raw, { value: caps })));
    }
