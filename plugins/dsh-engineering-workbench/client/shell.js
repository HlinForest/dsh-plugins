    function apply(ctx) {
      const slots = ctx.get('slots');
      let state = { open: false, tab: 'selection', minimized: innerWidth < 700, snapshot: { tasks: [], now: Date.now() }, offline: false, position: { right: 20, bottom: 22 } };
      try { const saved = JSON.parse(localStorage.getItem('dsh-engineering-workbench-position')); if (Number.isFinite(saved?.right) && Number.isFinite(saved?.bottom)) state.position = { right: Math.max(8, Math.min(saved.right, innerWidth - 295)), bottom: Math.max(8, Math.min(saved.bottom, innerHeight - 220)) }; } catch {}
      const listeners = new Set();
      const update = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn(); };
      const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
      const get = () => state;
      const useStore = () => useSyncExternalStore(subscribe, get, get);
      let stopped = false, timer, pollRunning = false;
      async function poll() {
        if (stopped || pollRunning) return; pollRunning = true;
        try { const snapshot = await api('status'); if (!stopped) update({ snapshot, offline: false }); }
        catch { if (!stopped) update({ offline: true }); }
        finally { pollRunning = false; if (!stopped) timer = setTimeout(poll, 1000); }
      }
      ctx.effect(() => { const style = document.createElement('style'); style.dataset.engineeringWorkbench = 'true'; style.textContent = css; document.head.appendChild(style); poll(); return () => { stopped = true; clearTimeout(timer); style.remove(); listeners.clear(); }; });
      function Entry(props) { const s = useStore(); return button([h(Icon, { key: 1, name: 'grid' }), props.wide === false ? null : h('span', { key: 2 }, '工程工作台')], () => update({ open: !s.open }), { className: 'ew-entry', title: '工程工作台', 'aria-label': '打开工程工作台' }); }
      function Workspace() {
        const s = useStore(); const panel = useRef(null), opened = useRef(false);
        if (s.open) opened.current = true;
        useEffect(() => { if (s.open) panel.current?.focus(); }, [s.open]);
        if (!opened.current) return null;
        return h('section', { className: 'ew ew-workbench', style: { display: s.open ? undefined : 'none' }, role: 'dialog', 'aria-label': '工程工作台', ref: panel, tabIndex: -1, onKeyDown: e => { if (e.key === 'Escape') update({ open: false }); } },
          h('header', { className: 'ew-header' }, h('div', { className: 'ew-brand' }, h(Icon, { name: 'circuit', size: 29 }), h('div', null, h('h1', null, '工程工作台'), h('small', null, '需求、证据与工程变化'))), h('nav', { className: 'ew-tabs', 'aria-label': '工作台功能' }, [['selection', '产品方案', 'power'], ['board', 'PCB 评审', 'circuit'], ['schematic', '原理图同步', 'circuit'], ['activity', '执行记录', 'activity']].map(([key, title, icon]) => button([h(Icon, { key: 'icon', name: icon, size: 16 }), title], () => update({ tab: key }), { key, className: s.tab === key ? 'ew-selected' : '', 'aria-pressed': s.tab === key }))), h('div', { className: 'ew-header-right' }, h('small', { className: s.offline ? 'ew-offline' : '' }, h('i', { className: 'ew-dot' }), s.offline ? '连接中断' : '本机引擎已连接'), button(h(Icon, { name: 'close' }), () => update({ open: false }), { className: 'ew-quiet', 'aria-label': '关闭工作台' }))),
          h('main', { className: 'ew-content' }, h('div', { style: { display: s.tab === 'selection' ? 'contents' : 'none' } }, h(Selection)), h('div', { hidden: s.tab !== 'board' }, h(PCB)), h('div', { hidden: s.tab !== 'schematic' }, h(Schematic)), s.tab === 'activity' && h('div', { className: 'ew-timeline' }, h('h2', null, '实际执行记录'), h('p', { className: 'ew-help' }, '记录工作台操作和该 DSH profile 的工程工具调用。耗时与步骤状态来自真实执行；重启后重新记录。'), s.snapshot.tasks.length ? s.snapshot.tasks.map(t => h(Task, { key: t.id, task: t, now: s.snapshot.now })) : h('div', { className: 'ew-loading' }, '输入需求、评审电路或处理原理图后，这里会出现执行记录。'))));
      }
      function Floating() {
        const s = useStore(); const drag = useRef(null);
        const task = s.snapshot.tasks.find(t => t.state === 'running') || s.snapshot.tasks[0];
        const elapsed = task ? Math.max(0, ((task.finishedAt || s.snapshot.now) - task.startedAt) / 1000) : 0;
        const done = task?.steps.filter(x => x.state === 'done').length || 0;
        const save = p => { update({ position: p }); try { localStorage.setItem('dsh-engineering-workbench-position', JSON.stringify(p)); } catch {} };
        const clamp = p => ({ right: Math.max(8, Math.min(p.right, Math.max(8, innerWidth - 295))), bottom: Math.max(8, Math.min(p.bottom, Math.max(8, innerHeight - 230))) });
        useEffect(() => { const resize = () => { save(clamp(get().position)); if (innerWidth < 700) update({ minimized: true }); }; window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
        const handle = { className: 'ew-drag', tabIndex: 0, role: 'button', 'aria-label': '拖动进度面板，或使用方向键移动', onPointerDown: e => { drag.current = { x: e.clientX, y: e.clientY, ...s.position }; e.currentTarget.setPointerCapture(e.pointerId); }, onPointerMove: e => { if (drag.current) update({ position: clamp({ right: drag.current.right - e.clientX + drag.current.x, bottom: drag.current.bottom - e.clientY + drag.current.y }) }); }, onPointerUp: () => { drag.current = null; save(get().position); }, onPointerCancel: () => { drag.current = null; }, onKeyDown: e => { const d = { ArrowLeft: [16, 0], ArrowRight: [-16, 0], ArrowUp: [0, 16], ArrowDown: [0, -16] }[e.key]; if (d) { e.preventDefault(); save(clamp({ right: s.position.right + d[0], bottom: s.position.bottom + d[1] })); } } };
        return h('aside', { className: `ew ew-float${s.minimized ? ' ew-mini' : ''}`, style: s.position, 'aria-label': '工程任务悬浮面板' },
          h('div', { className: 'ew-float-head' }, h('div', handle, h(Icon, { name: 'activity', size: 15 }), '工程进度'), button(s.minimized ? '展开' : '收起', () => update({ minimized: !s.minimized }), { className: 'ew-quiet' })),
          !s.minimized && h('div', { className: 'ew-float-body' }, h('div', { className: 'ew-float-label', title: task?.label }, task?.state === 'running' && h('i', { className: 'ew-busy-dot' }), task?.label || '等待工程任务'), h('div', { className: 'ew-float-time' }, num(elapsed), h('small', null, ' 秒')), task?.steps.length > 0 && h('div', { className: 'ew-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': task.steps.length, 'aria-valuenow': done, 'aria-label': '已完成实际步骤' }, h('span', { style: { width: `${done / task.steps.length * 100}%` } })), h('small', { role: 'status' }, s.offline ? '连接中断，显示最后已知状态' : !task ? '从侧栏打开工作台开始处理任务' : task.state === 'failed' ? '执行失败，请查看记录' : task.state === 'done' ? '已完成' : task.steps.find(x => x.state === 'running')?.label || '工具执行中'), h('div', { className: 'ew-float-actions' }, h('small', null, `${s.snapshot.tasks.filter(t => t.state === 'running').length} 项正在执行`), button('打开工作台', () => update({ open: true }), { className: 'ew-quiet' }))));
      }
      slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'engineering-workbench.open', order: 15, label: () => '工程工作台' }, Entry));
      slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'engineering-workbench.workspace', order: 30 }, Workspace));
      slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'engineering-workbench.progress', order: 31 }, Floating));
    }
