    function Restoration({ onOpenManual }) {
      const checkLabels = { libraryDependencies: '符号或封装库缺失、无效', sourceGraphicText: '原始图形文字有遗漏', footprintAssignments: '器件封装分配有遗漏', modelReferenceCoverage: '三维模型引用数量不一致', modelDependencies: '三维模型文件无法解析', sourceIntegrity: '原始输入文件发生变化', connectivity: '引脚连接不一致', connectivityUnavailable: '未能获得连接检查结果', parameters: '器件参数不一致', components: '器件数量或身份不一致', placement: '器件位置不一致', wireGeometry: '导线路径不一致', pinDefinitions: '引脚定义不一致', pinEndpoints: '引脚连接端点不一致', no_connect: '未连接标记不一致', junction: '连接点不一致', netNames: '网络名称不一致', pcbImportedGeometry: 'PCB 几何存在差异', pcbBoardGraphics: 'PCB 文字或机械图形存在差异', independentImportUnavailable: '原始 PCB 对照导入失败', toolExecution: '检查工具执行失败' };
      Object.assign(checkLabels, { symbolOutlines: '符号直线轮廓存在差异', symbolCurves: '圆角或圆弧形状存在差异', visibleFieldPlacement: '器件文字位置或隐藏状态不一致', graphicTextPlacement: '图形文字重复、遗漏或位置不一致', sheetContentBounds: '图形或文字超出页面', schematicPcbAssociation: '原理图与 PCB 的器件关联不正确', schematicObjectIdentity: '原理图对象标识无效或重复', pcbObjectIdentity: 'PCB 对象标识无效或重复', ruleConfiguration: '原始设计规则尚未配置' });
      Object.assign(checkLabels, { libraryFootprintGeometry: '封装库与板上封装的焊盘或图形不一致', modelAssetAndPlacement: '模型文件身份或实例位置不一致', modelPosePreservation: '三维模型变换存在差异', pinTextVisibility: '引脚名称或编号的显示状态不一致', nativeTextStyle: '字体、文字角度或样式不一致' });
      const work = useWork(), [runs, setRuns] = useState([]), [run, setRun] = useState(null), [manifest, setManifest] = useState(''), [project, setProject] = useState(''), [entry, setEntry] = useState('');
      const [inputMode, setInputMode] = useState('native'), [nativeSch, setNativeSch] = useState(''), [nativePcb, setNativePcb] = useState(''), [nativeProject, setNativeProject] = useState('');
      const [manuals, setManuals] = useState([]), [manualId, setManualId] = useState(''), [pdf, setPdf] = useState(''), [mpn, setMpn] = useState(''), [pkg, setPkg] = useState(''), [refs, setRefs] = useState('');
      const [note, setNote] = useState(''), [decision, setDecision] = useState('needs-work'), [environment, setEnvironment] = useState(null);
      const refresh = () => work.run('读取复原记录', async () => { setRuns(await api('restoration', { action: 'list' })); setManuals((await api('engineering', { action: 'list' })).filter(t => t.kind === 'datasheet')); });
      useEffect(() => { refresh(); }, []);
      const execute = (action, args = {}) => work.run('处理复原任务', async () => { const value = await api('restoration', { action, runId: run?.id, ...args }); setRun(value); setRuns(await api('restoration', { action: 'list' })); });
      const open = id => work.run('读取当前结果', async () => { const value = await api('restoration', { action: 'open', runId: id }); setRun(value); setProject(value.validation?.project || ''); setEntry(value.replay?.entry || ''); });
      return h('section', { className: 'ew-engineering' },
        h('div', { className: 'ew-section-head' }, h('div', null, h('h2', null, '从原始资料复原'), h('p', { className: 'ew-help' }, '冻结资料 → 原理图 → BOM → PCB → 独立检查 → 空目录重放 → 工程师评审。完整性、一致性和评审结果分别保留。')), button('刷新记录', refresh, { disabled: !!work.busy })),
        h(Alert, { work }),
        h(Field, { label: '资料入口' }, selectInput(inputMode, setInputMode, [['native', '直接读取本机原始文件'], ['manifest', '使用已有冻结证据包']], { disabled: !!work.busy })),
        h('p', { className: 'ew-help' }, '路径由运行 Harness 的电脑读取。远程浏览器请填写服务端路径；文件内容交给模型时沿用当前 Harness 模型连接。'),
        inputMode === 'native' ? h(R.Fragment, null,
          h(FilePicker, { label: '原始 Altium 原理图', value: nativeSch, onChange: setNativeSch, extensions: ['.schdoc'], disabled: !!work.busy }),
          h(FilePicker, { label: '原始 Altium PCB', value: nativePcb, onChange: setNativePcb, extensions: ['.pcbdoc'], disabled: !!work.busy }),
          h(FilePicker, { label: '原始 Altium 工程（可选）', value: nativeProject, onChange: setNativeProject, extensions: ['.prjpcb'], disabled: !!work.busy }),
          h('p', { className: 'ew-help' }, '当前直接提取支持一个无层级原理图页和一块 PCB。层级、总线、隐藏引脚等超出适配范围时保留资料并列出原因。原文件保持不变。'),
          button('读取、提取并冻结原始资料', () => execute('prepare-native', { schematic: nativeSch, pcb: nativePcb, nativeProject }), { disabled: !!work.busy || !nativeSch || !nativePcb })) :
          h('div', { className: 'ew-form-row' }, h(FilePicker, { label: '冻结证据清单', value: manifest, onChange: setManifest, extensions: ['.json'], disabled: !!work.busy }), button('创建独立复原任务', () => execute('create', { manifest }), { disabled: !!work.busy || !manifest })),
        button('检查本机工具', () => work.run('检查工具环境', async () => setEnvironment(await api('restoration', { action: 'preflight' }))), { disabled: !!work.busy }),
        environment && h('p', { className: 'ew-note' }, `工具检查：${environment.status} · KiCad ${environment.kicad}`),
        h(Field, { label: '已冻结任务' }, selectInput(run?.id || '', id => { if (id) open(id); }, [['', '选择任务'], ...runs.map(r => [r.id, r.label + ' · ' + new Date(r.updatedAt).toLocaleString()])], { disabled: !!work.busy })),
        run && h(R.Fragment, null,
          h('p', { className: 'ew-note' }, `${run.label} · ${run.fileCount} 个原始资料文件 · ${run.inputFresh ? '输入快照有效' : '输入已变化'}。当前为技术演示，尚未获得完整 1:1 结论。`),
          run.intake && h('p', { className: 'ew-note' }, `本机提取：${run.intake.extraction.components} 个原理图对象、${run.intake.extraction.pins} 个引脚、${run.intake.extraction.embeddedModels} 个嵌入模型。原文件哈希未变。`),
          h('p', { className: 'ew-help' }, `下一步在当前 Harness 对话中要求模型使用 engineering_restore inspect 读取任务 ${run.id}，在新目录编写转换脚本、生成工程并执行 verify。工具入口负责提取与核验，转换由当前模型执行。`),
          h(Table, { columns: [['阶段', 'name'], ['需要的输入', 'input'], ['状态', 'status']], rows: run.stages }),
          h('h3', null, '检查本轮生成的工程'),
          h(FilePicker, { label: '可编辑 KiCad 工程', value: project, onChange: setProject, extensions: ['.kicad_pro'], disabled: !!work.busy }),
          h('div', { className: 'ew-actions' }, button('检查原理图', () => execute('verify', { project, stage: 'schematic' }), { disabled: !!work.busy || !project }), button('检查完整工程', () => execute('verify', { project, stage: 'full' }), { disabled: !!work.busy || !project })),
          run.validation && h(R.Fragment, null, h('p', { className: run.validationFresh ? 'ew-note' : 'ew-error' }, `检查结论：${run.validation.status}。${run.validationFresh ? '报告对应当前工程文件。' : '工程或报告已变化，需要重新检查。'}`), h(Bullets, { items: run.validation.failedChecks.map(key => checkLabels[key] || '其他检查未通过，请展开核验结果') }), h(Artifacts, { value: run }), h(Raw, { value: run.validation.checks, title: '逐项核验结果与限制' })),
          h(FilePicker, { label: '本轮生成的重放入口', value: entry, onChange: setEntry, extensions: ['.py'], disabled: !!work.busy }),
          button('在新目录重放并比较', () => execute('replay', { entry }), { disabled: !!work.busy || !entry || !run.validationFresh }),
          run.replay && h('p', { className: 'ew-note' }, `重放：${run.replay.match ? '工程文件一致' : '存在差异'} · 比较 ${run.replay.compared} 个文件`),
          h('h3', null, '补充规格书'),
          h('p', { className: 'ew-help' }, '选择用户提供的 PDF，读取后绑定准确型号、封装和位号。提取参数保留页码、原文和来源哈希，工程师复核前保持草稿。'),
          h(FilePicker, { label: '新增 PDF 规格书', value: pdf, onChange: setPdf, extensions: ['.pdf'], disabled: !!work.busy }),
          button('读取此 PDF', () => work.run('建立手册资料', async () => { const task = await api('engineering', { action: 'create', kind: 'datasheet', left: pdf }); setManualId(task.id); setManuals((await api('engineering', { action: 'list' })).filter(t => t.kind === 'datasheet')); onOpenManual(task.id); }), { disabled: !!work.busy || !pdf }),
          h(Field, { label: '已读取手册' }, selectInput(manualId, setManualId, [['', '选择手册'], ...manuals.map(m => [m.id, m.label])])),
          h('div', { className: 'ew-form-row' }, h(Field, { label: '准确器件型号' }, textInput(mpn, setMpn)), h(Field, { label: '封装' }, textInput(pkg, setPkg)), h(Field, { label: '绑定位号，以逗号分隔' }, textInput(refs, setRefs))),
          button('绑定到本任务', () => execute('bind-datasheet', { taskId: manualId, mpn, package: pkg, references: refs.split(/[,，]/).map(s => s.trim()).filter(Boolean) }), { disabled: !!work.busy || !manualId || !mpn || !pkg || !refs }),
          h(Table, { columns: [['手册', 'title'], ['型号', 'mpn'], ['封装', 'package'], ['位号', r => r.references.join('、')], ['复核', r => '待工程师确认']], rows: run.datasheets }),
          h('h3', null, '工程师需要补充的证据'), h(Table, { columns: [['资料', 'title'], ['具体获取方法', 'obtain'], ['状态', 'status']], rows: run.gaps }),
          h('h3', null, '记录当前技术演示的评审'), h('p', { className: 'ew-help' }, '这里记录本机工程师对当前报告的意见；公司正式签核和生产放行另行执行。'),
          h(Field, { label: '评审结论' }, selectInput(decision, setDecision, [['needs-work', '需要继续修复'], ['demo-reviewed', '已审阅技术演示']])), h(Field, { label: '具体意见' }, textarea(note, setNote)),
          button('保存工程师意见', () => execute('review', { decision, note, reportHash: run.validation?.reportHash }), { disabled: !!work.busy || !run.validationFresh || !note.trim() }),
          run.review && h('p', { className: 'ew-note' }, (run.review.stale ? '此意见对应旧报告：' : '已记录：') + run.review.note)));
    }
