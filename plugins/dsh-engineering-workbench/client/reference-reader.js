    function ReferenceReader({ task, side, execute }) {
      const work = useWork(), [status, setStatus] = useState(null), [loaded, setLoaded] = useState(false);
      const design = task[side].design;
      const call = (action) => api('references', { action, taskId: task.id, side });
      useEffect(() => { let alive = true; call('status').then(value => { if (alive) { setStatus(value); setLoaded(true); } }).catch(() => { if (alive) work.setError('无法读取识别状态，请刷新任务。'); }); return () => { alive = false; }; }, [task.id, side]);
      useEffect(() => {
        if (!status?.active) return;
        let stopped = false;
        const poll = async () => { try { const value = await call('status'); if (!stopped) { setStatus(value); work.setError(''); if (!value.active && status.activeSide === side) await execute('open', { taskId: task.id }); } } catch { if (!stopped) work.setError('暂时无法获取识别进度，正在重试。'); } };
        const stop = visiblePoll(poll, 1500); return () => { stopped = true; stop(); };
      }, [status?.active, status?.activeSide, task.id, side]);
      const run = status?.run, pages = run?.completedPages.length || 0;
      return h('section', { className: 'ew-reference-card', 'aria-label': side === 'right' ? '读取目标资料' : '读取源资料' },
        h('h3', null, (side === 'right' ? '目标' : '源') + ' PDF / 图片识别'),
        h('p', { className: 'ew-help' }, `共 ${design.pages} 页。逐页识别图中的器件、引脚与连接，完成后再核对对应关系。`), h(Alert, { work }),
        h('div', { className: 'ew-reading-progress', role: 'status' }, h('strong', null, run?.message || '已生成预览，尚未识别电路内容。'), h('progress', { value: pages, max: design.pages, 'aria-label': '资料识别进度' }), h('small', null, `已识别 ${pages} / ${design.pages} 页 · 当前已保存 ${design.components.length} 个器件`)),
        status?.active ? status.activeSide !== side ? h('p', { role: 'status' }, '正在识别另一侧资料，完成后可继续。') : button(status.stopping ? '正在暂停…' : '暂停识别', () => work.run('暂停识别', async () => setStatus(await call('stop'))), { disabled: !!work.busy || status.stopping }) : button(run?.state === 'complete' ? '识别已完成' : pages ? '继续识别剩余页面' : '识别全部页面并生成对应建议', () => work.run('开始识别', async () => setStatus(await call('start'))), { className: 'ew-primary', disabled: !loaded || !!work.busy || run?.state === 'complete' }),
        run?.state === 'complete' && h('p', { className: 'ew-note' }, '识别条目仍需对照原图核对。两次提取有差异的页面会标注不确定性，不能据此认定完整连接相同。'));
    }
