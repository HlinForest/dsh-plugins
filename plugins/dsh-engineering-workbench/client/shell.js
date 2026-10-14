    const navigation = [...Object.entries(engineeringTitles).map(([key, title]) => [key, title, key === 'selection' ? 'power' : 'circuit']),
      ['restoration', '工程复原', 'circuit'], ['materials', '资料管理', 'grid'], ['activity', '执行记录', 'activity'], ['legacy', '历史同步任务', 'circuit']];
    const desktop = window.workbenchDesktop;
    if (desktop) {
      document.documentElement.dataset.desktop = 'true';
      desktop.onVisibility(value => { desktopVisible = value; document.dispatchEvent(new Event('workbenchvisibility')); });
    }
    function Workspace() {
      const [tab, setTab] = useState('pcb-review'), [requested, setRequested] = useState(null);
      const visited = useRef(new Set(['pcb-review'])); visited.current.add(tab);
      const [snapshot, setSnapshot] = useState({ tasks: [], now: Date.now() });
      const [connection, setConnection] = useState('connecting'), [error, setError] = useState('');
      const [build, setBuild] = useState(null);
      useEffect(() => { api('bootstrap').then(setBuild).catch(() => {}); }, []);
      useEffect(() => {
        let disposed = false, timer, running = false;
        const poll = async () => {
          clearTimeout(timer);
          if (disposed || !pageVisible() || running) return;
          running = true;
          try { const result = await api('status'); if (!disposed) { setSnapshot(result); setConnection('connected'); setError(''); } }
          catch (e) { if (!disposed) { setConnection('failed'); setError(e.message); } }
          finally { running = false; if (!disposed && pageVisible()) timer = setTimeout(poll, 1500); }
        };
        const visibility = () => { clearTimeout(timer); if (pageVisible()) poll(); };
        document.addEventListener('visibilitychange', visibility); poll();
        document.addEventListener('workbenchvisibility', visibility);
        return () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); document.removeEventListener('workbenchvisibility', visibility); };
      }, []);
      const title = navigation.find(row => row[0] === tab)?.[1] || '工程工作台';
      useEffect(() => { document.title = `${title} · 工程工作台`; }, [title]);
      const openTask = (kind, id) => { setRequested({ kind, id }); setTab(kind); };
      const count = snapshot.tasks.filter(task => task.state === 'running').length;
      const progress = connection === 'connecting' ? '连接中' : connection === 'failed' ? '连接中断' : count ? `${count} 项正在执行` : '工程进度';
      return h('div', { className: 'ew ew-workbench' },
        desktop && h('div', { className: 'ew-titlebar' }, h('span', { className: 'ew-titlebar-label' }, h(Icon, { name: 'grid', size: 16 }), h('span', null, `${title} · 工程工作台`))),
        h('header', { className: 'ew-header' },
          h('div', { className: 'ew-brand' }, h(Icon, { name: 'grid', size: 24 }), h('h1', null, '工程工作台')),
          h('div', { className: 'ew-header-right' }, button([h(Icon, { name: 'activity', key: 'icon', size: 18 }), h('span', { key: 'text' }, progress)], () => setTab('activity'),
            { className: 'ew-progress-entry ew-quiet', title: error || '查看执行记录', 'aria-label': '查看工程进度', 'data-state': connection })),
          h('nav', { className: 'ew-tabs', 'aria-label': '工作台功能' }, navigation.map(([key, label, icon]) => button([h(Icon, { key: 'icon', name: icon, size: 16 }), label], () => setTab(key),
            { key, className: tab === key ? 'ew-selected' : '', 'aria-pressed': tab === key })))),
        h('main', { className: 'ew-content', 'aria-label': title },
          connection === 'failed' && h('div', { className: 'ew-error ew-connection-error', role: 'alert' }, error),
          ...Object.keys(engineeringTitles).filter(key => visited.current.has(key)).map(key => h('div', { key, hidden: tab !== key },
            key === 'selection' ? h(Selection) : h(Engineering, { kind: key, requestedTask: requested?.kind === key ? requested.id : undefined }))),
          visited.current.has('restoration') && h('div', { hidden: tab !== 'restoration' }, h(Restoration, { onOpenManual: id => openTask('datasheet', id) })),
          visited.current.has('materials') && h('div', { hidden: tab !== 'materials' }, h(EngineeringMaterials, { onOpen: openTask })),
          visited.current.has('legacy') && h('div', { hidden: tab !== 'legacy' }, h(Schematic)),
          tab === 'activity' && h('div', { className: 'ew-timeline' }, h('h2', null, '执行记录'),
            h('p', { className: 'ew-help' }, '工作台操作与工程工具调用的实际进度。记录保留至本次 Harness 退出。'),
            snapshot.tasks.length ? snapshot.tasks.map(task => h(Task, { key: task.id, task, now: snapshot.now })) : h('div', { className: 'ew-loading' }, '开始处理任务后，可在这里查看进度与结果。'),
            build?.version && h('p', { className: 'ew-build' }, `工程工作台 ${build.version} · ${build.build}`))));
    }
    createRoot(document.getElementById('root')).render(h(Workspace));
