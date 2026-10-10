    function Selection() {
      const work = useWork();
      const [info, setInfo] = useState(null), [text, setText] = useState(''), [extras, setExtras] = useState([]);
      const [family, setFamily] = useState(''), [limit, setLimit] = useState(10), [include, setInclude] = useState(true);
      const [parsed, setParsed] = useState(null), [result, setResult] = useState(null), [candidate, setCandidate] = useState(null);
      const [chosen, setChosen] = useState([]), [report, setReport] = useState(null), [title, setTitle] = useState('客户需求与产品方案');
      const revision = useRef(0);
      useEffect(() => { work.run('读取产品资料库', async () => { const x = await invoke('selection', 'info'); setInfo(x); setLimit(x.maxCandidates); }); }, []);
      const invalidate = () => { revision.current++; setParsed(null); setResult(null); setCandidate(null); setChosen([]); setReport(null); };
      const changeText = v => { setText(v); invalidate(); };
      const changeExtras = v => { setExtras(v); invalidate(); };
      const args = () => ({ text, constraints: constraintArgs(extras, info?.fields || {}) });
      const searchArgs = () => ({ ...args(), ...(family ? { family } : {}), limit: Number(limit), includeIncompatible: include });
      const parse = () => work.run('解析并列出需求条件', async () => { const n = revision.current; const x = await invoke('selection', 'parse', args()); if (n === revision.current) setParsed(x); });
      const search = () => work.run('按需求检索与校验', async () => {
        const n = revision.current, x = await invoke('selection', 'search', searchArgs());
        if (n !== revision.current) return;
        setResult(x); setParsed(x.requirements); setCandidate(x.candidates[0] || null); setChosen([]); setReport(null);
      });
      const validate = productId => work.run('复核指定候选', async () => { const n = revision.current; const x = await invoke('selection', 'validate', { ...args(), productId, expectedCatalogRevision: result.catalogRevision }); if (n === revision.current) setCandidate(x.candidate); });
      const makeReport = action => work.run(action === 'export' ? '导出完整方案报告' : '生成方案报告', async () => {
        const n = revision.current, x = await invoke('selection', action, { ...searchArgs(), title, expectedCatalogRevision: result.catalogRevision, ...(chosen.length ? { productIds: chosen } : {}) });
        if (n === revision.current) setReport(x);
      });
      const requirements = parsed?.constraints ?? [];
      const fields = info?.fields || {};
      const expected = c => c.operator === 'range' ? `${c.min}–${c.max}${fields[c.field]?.unit || ''}` : `${({ gte: '≥', lte: '≤', eq: '=', includes: '包含' })[c.operator]} ${c.textValue ?? c.value}${fields[c.field]?.unit || ''}`;
      const sources = result?.sources || info?.sources || [];
      return h('div', { className: 'ew-business' },
        h('div', { className: 'ew-page-intro' }, h('div', null, h('h2', null, '客户需求与产品方案'), h('p', null, '保留客户原文，逐项核对条件、候选与资料依据。')), button('刷新资料库信息', () => work.run('刷新资料库', async () => { invalidate(); setInfo(await invoke('selection', 'info')); }), { disabled: !!work.busy })),
        h(Alert, { work }),
        info && h('div', { className: 'ew-dataset' }, h('strong', null, info.dataset), h('span', null, `${info.productCount} 个型号`), h('span', null, `版本 ${info.catalogVersion}`), h('span', { className: info.demo ? 'ew-warning-text' : '' }, info.demo ? '虚构演示库' : '已配置资料库'), h('small', null, '资料快照 ' + info.catalogRevision.slice(0, 12))),
        h('div', { className: 'ew-request-grid' },
          h('section', { className: 'ew-paper' }, h('h3', null, '需求原文'),
            h(Field, { label: '客户需求' }, textarea(text, changeText, { rows: 9, placeholder: '粘贴真实需求，例如输入/输出电压、功率、环境温度、效率、通信、认证及安装限制。未提供的条件不会自动补上。', maxLength: info?.maxInputChars || 500000 })),
            h('div', { className: 'ew-inline' }, h('label', { className: 'ew-file-import' }, '载入 TXT / Markdown', h('input', { type: 'file', accept: '.txt,.md,text/plain', onChange: async e => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 2 * 1024 * 1024) { work.setError('需求文件超过 2 MiB，请先提取相关段落。'); return; } changeText(await f.text()); e.target.value = ''; } })), h('small', null, 'PDF / Word 可在 DSH 读取后粘贴需求段落。')),
            h('details', { className: 'ew-examples' }, h('summary', null, '载入可选示例'),
              button('48V 通信电源需求', () => changeText('输入电压：180–264VAC；输出电压：48VDC；输出功率不少于3kW；效率至少96%；工作温度：-20–60℃；通信协议：CAN、RS485；认证：CE、UL；散热方式：风冷。'), { disabled: !!work.busy }),
              button('24V 控制柜电源需求', () => changeText('输出电压：24VDC；输入电压：176–264VAC；输入频率：50–60Hz；安装方式：导轨；本体宽度≤65mm；DC OK继电器：有；持续负载：300W；设计裕量：20%；环境温度：55℃；安装姿态：垂直且输入端子朝下；海拔：1000m；上方间距：50mm；下方间距：40mm；侧面间距：15mm。'), { disabled: !!work.busy })),
            h('div', { className: 'ew-form-row' }, h(Field, { label: '产品类别' }, selectInput(family, v => { setFamily(v); invalidate(); }, [['', '全部类别'], ...(info?.families || [])])), h(Field, { label: '候选展示上限' }, h('input', { type: 'number', value: limit, min: 1, max: info?.maxCandidates || 10, onChange: e => { setLimit(e.target.value); invalidate(); } }))),
            checkbox('同时列出不满足项，便于解释排除原因', include, v => { setInclude(v); invalidate(); }),
            h('div', { className: 'ew-actions' }, button('解析需求', parse, { disabled: !!work.busy || !text.trim() || !info }), button('检索并校验候选', search, { className: 'ew-primary', disabled: !!work.busy || !text.trim() || !info }))),
          h('section', { className: 'ew-paper' }, h('h3', null, '已提取条件'),
            requirements.length ? h(Table, { columns: [['条件', c => fields[c.field]?.label || c.field], ['要求', expected], ['类型', c => c.hard ? '硬条件' : '偏好'], ['原文依据', 'sourceQuote']], rows: requirements }) : empty('输入需求并解析后，这里显示实际提取的条件。'),
            parsed && h(R.Fragment, null, h('h3', { className: 'ew-section-title' }, '待确认与解析提示'), (parsed.unresolved?.length || parsed.warnings?.length) ? h(Bullets, { items: [...(parsed.unresolved || []), ...(parsed.warnings || [])] }) : h('p', { className: 'ew-help' }, '本次解析没有列出待确认项；仍需核对条件是否完整。'),
              h(Bullets, { items: parsed.calculations?.map(c => `${c.loadW} W × (1 + ${c.marginPct}%) = ${c.requiredContinuousW} W 连续能力要求`) })))),
        h('details', { className: 'ew-paper ew-extra' }, h('summary', null, `补充复杂条件${extras.length ? '（' + extras.length + ' 项）' : ''}`), h('p', { className: 'ew-help' }, '只能补充有原文依据的条件。需要更正已提取条件时，请修改需求原文后重新解析。'), h(ConstraintEditor, { fields, value: extras, onChange: changeExtras, disabled: !!work.busy })),
        result && h('section', { className: 'ew-paper ew-section' },
          h('div', { className: 'ew-section-head' }, h('h3', null, '候选比较'), h('small', null, `评估 ${result.totalEvaluated} 个，当前显示 ${result.candidates.length} 个；得分不是置信度。`)),
          result.candidates.length ? h(Table, { columns: [
            ['纳入方案', c => checkbox(c.productId, chosen.includes(c.productId), yes => { revision.current++; setChosen(x => yes ? [...x, c.productId] : x.filter(id => id !== c.productId)); setReport(null); }, { 'aria-label': '纳入方案 ' + c.productId })],
            ['型号 / 名称', c => h('div', null, button(c.productId, () => setCandidate(c), { className: 'ew-quiet' }), h('small', null, c.productName))],
            ['结论', c => chip(c.status)], ['已核验连续能力', c => c.power?.verifiedContinuousW === undefined ? '—' : c.power.verifiedContinuousW + ' W'],
            ['未满足或待确认', c => c.checks.filter(k => k.status !== 'pass').map(k => k.label).join('、') || '已列条件逐项通过'],
            ['操作', c => button('重新复核', () => validate(c.productId), { disabled: !!work.busy, 'aria-label': '复核 ' + c.productId })],
          ], rows: result.candidates, rowKey: c => c.productId }) : empty('当前资料库没有符合筛选条件的候选。可显示不满足项以查看排除原因。'),
          h(PowerOverview, { result }),
          candidate && h('div', { className: 'ew-details' }, h('h3', null, candidate.productId + ' 的逐项校验'), h(Table, { columns: [['条件', 'label'], ['要求', 'expected'], ['资料值', 'actual'], ['结果', c => chip(c.status)], ['依据', c => h('div', null, c.reason, c.quote && h('blockquote', null, c.quote), c.source && h('small', null, c.source.id + ' · ' + c.source.version + ' · ' + (c.source.location || '')))]], rows: candidate.checks })),
          h('details', { className: 'ew-extra' }, h('summary', null, '资料来源与原件'), sources.map((s, i) => h('div', { key: s.id || i, className: 'ew-source' }, h('strong', null, s.title || s.id), h('p', null, s.version, ' · ', s.location), s.previewUrl ? link('打开原件', s.previewUrl) : h('small', null, s.previewError || '未登记可预览的本机原件'), s.url && /^https?:/.test(s.url) && h('span', null, '　', link('官网来源', s.url))))),
          h('div', { className: 'ew-section-head' }, h('h3', null, '方案与报告'), h('small', null, chosen.length ? `选择 ${chosen.length} 个候选，生成时再次校验` : '未指定候选，按插件规则生成完整报告')),
          h(Field, { label: '报告标题' }, textInput(title, v => { revision.current++; setTitle(v); setReport(null); }, { maxLength: 200 })),
          h('div', { className: 'ew-actions' }, button('生成方案', () => makeReport('report'), { disabled: !!work.busy, className: 'ew-primary' }), button('导出 HTML / Markdown / JSON', () => makeReport('export'), { disabled: !!work.busy })),
          report && h('div', { className: 'ew-report' }, h(Artifacts, { value: report }), h(TextReport, { text: report.markdown }))),
        info && h('details', { className: 'ew-extra' }, h('summary', null, '资料库范围与限制'), h(Bullets, { items: info.limitations }), h(Raw, { value: info, title: '资料库信息' })));
    }
    function PowerOverview({ result }) {
      const rows = result.candidates.filter(c => c.power).slice(0, 8);
      if (!rows.length) return null;
      const required = result.requirements.calculations?.[0]?.requiredContinuousW;
      const max = Math.max(required || 0, ...rows.map(c => c.power.ratedW || 0), 1) * 1.12;
      return h('div', { className: 'ew-chart ew-section' }, h('h3', null, '候选连续供电能力'), h('p', { className: 'ew-help' }, '浅色为额定值，深色为本次明确工况下已核验值。未知能力显示为“—”。'), h('div', { className: 'ew-bars' }, rows.map(c => h('div', { className: 'ew-bar-row', key: c.productId }, h('span', null, c.productId), h('div', { className: 'ew-bar-track' }, h('span', { className: 'ew-rated', style: { width: (c.power.ratedW || 0) / max * 100 + '%' } }), h('span', { className: 'ew-verified', style: { width: (c.power.verifiedContinuousW || 0) / max * 100 + '%' } }), required !== undefined && h('span', { className: 'ew-target-line', style: { left: required / max * 100 + '%' } })), h('span', null, num(c.power.verifiedContinuousW) + ' W')))));
    }
