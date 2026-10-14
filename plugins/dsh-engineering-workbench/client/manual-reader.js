    function ManualReader({ task, execute }) {
      const work = useWork(), [status, setStatus] = useState(null), [query, setQuery] = useState(''), [hits, setHits] = useState(null), [tab, setTab] = useState('book'), [notePage, setNotePage] = useState(0);
      const alive = useRef(true), generation = useRef(0), readerRoot = useRef(null);
      const call = async (action, extra = {}) => api('manuals', { action, taskId: task.id, ...extra });
      const update = value => { if (alive.current) setStatus(value); };
      useEffect(() => { alive.current = true; work.run('建立整本索引', async () => { const value = await call('index'); update(value); if (alive.current && value.active) setTab(value.active); }); return () => { alive.current = false; }; }, [task.id]);
      useEffect(() => {
        if (!status?.active) return;
        let stopped = false;
        const poll = async () => { try { const value = await call('status'); if (!stopped) { update(value); work.setError(''); } } catch { if (!stopped) work.setError('进度暂时连接失败，正在重试；已保存的阅读结果会保留。'); } };
        const stop = visiblePoll(poll, 1500); return () => { stopped = true; stop(); };
      }, [status?.active, task.id]);
      const start = mode => work.run('启动自动阅读', async () => { setTab(mode); setNotePage(0); update(await call('start', { mode, question: query.trim() })); });
      const search = offset => work.run('搜索整本手册', async () => { const version = generation.current, value = await call('search', { query, offset: offset || 0 }); if (generation.current === version) setHits(value); });
      const jump = async page => { const result = await execute('page', { side: 'left', page }); if (result) requestAnimationFrame(() => { const preview = readerRoot.current?.closest('.ew-task-body')?.querySelector('.ew-manual-preview'); preview?.focus(); preview?.scrollIntoView({ block: 'start' }); }); };
      const citations = rows => h('div', { className: 'ew-citations' }, rows.map((c, i) => h('details', { key: i }, h('summary', null, `第 ${c.page} 页 · ${c.verification === 'image-unverified' ? '图像摘录待核对' : '原文已匹配'}`), h('blockquote', null, c.quote), button('查看第 ' + c.page + ' 页原文', () => jump(c.page)))));
      const run = status?.[tab], index = status?.index || task.manual, busy = !!work.busy, active = !!status?.active;
      const notes = [...(run?.notes || []).map(n => ({ ...n, type: 'note' })), ...(run?.facts || []).map(n => ({ ...n, type: 'fact' }))];
      return h('section', { className: 'ew-reference-card ew-manual-reader', ref: readerRoot, tabIndex: -1, 'aria-label': '整本手册阅读' },
        h('div', { className: 'ew-section-head' }, h('div', null, h('h3', null, '整本手册阅读'), h('p', { className: 'ew-help' }, index ? `已索引 ${index.indexedPages} 页 · ${index.textPages} 页含文字 · ${index.imagePages.length} 页需图像阅读` : '正在建立全文索引…')), button(active ? '阅读进行中' : ['paused', 'failed', 'partial'].includes(status?.book?.state) ? '继续自动通读' : status?.book?.state === 'complete' ? '整本已通读' : '自动通读整本', () => start('book'), { className: 'ew-primary', disabled: busy || active || status?.book?.state === 'complete' || !index })),
        h('p', { className: 'ew-help' }, '全文搜索立即可用。自动通读会分批整理要点与参数，保留页码和原文；可暂停后继续。'),
        h(Alert, { work }),
        h('form', { className: 'ew-manual-search', onSubmit: e => { e.preventDefault(); search(0); } }, h(Field, { label: '搜索整本手册或提出问题' }, textInput(query, value => { generation.current++; setQuery(value); setHits(null); }, { placeholder: '例如：接线方式、输出电压、故障代码', maxLength: 2000 })), h('div', { className: 'ew-inline' }, h('button', { type: 'submit', disabled: busy || !query.trim() || !index }, '搜索全文'), button('按问题阅读', () => start('question'), { disabled: busy || active || !query.trim() || !index }))),
        hits && h('div', { className: 'ew-search-hits' }, h('h4', null, `找到 ${hits.total} 页相关内容`), !hits.total && h('p', null, '换用参数名、型号或章节关键词。扫描页不在文本搜索范围内。'), hits.items.map(row => h('article', { key: row.page }, button(`第 ${row.page} 页 · ${row.title}`, () => jump(row.page)), h('blockquote', null, row.quote))), hits.nextOffset != null && button('查看更多匹配页', () => search(hits.nextOffset))),
        index?.toc?.length > 0 && h('details', { className: 'ew-reader-toc' }, h('summary', null, `章节目录（${index.toc.length} 项）`), h('nav', { 'aria-label': '手册章节' }, index.toc.map((row, i) => button(`${row.title} · 第 ${row.page} 页`, () => jump(row.page), { key: i, className: 'ew-quiet' })))),
        (status?.book || status?.question) && h(R.Fragment, null,
          h('div', { className: 'ew-inline', role: 'group', 'aria-label': '阅读结果' }, button('通读笔记', () => { setTab('book'); setNotePage(0); }, { 'aria-pressed': tab === 'book' }), button('问题回答', () => { setTab('question'); setNotePage(0); }, { 'aria-pressed': tab === 'question' })),
          run && h(R.Fragment, null, h('div', { className: 'ew-reading-progress', role: 'status' }, h('strong', null, run.message || '准备阅读…'), h('progress', { value: run.completed.length, max: Math.max(1, run.totalUnits), 'aria-label': '阅读进度' }), h('small', null, `已处理 ${run.completedPages.length} / ${run.totalPages} 页 · ${run.skippedPages.length} 页未识别${run.matchingPages != null ? ` · 全文匹配 ${run.matchingPages} 页，本次阅读最相关 ${run.totalPages} 页` : ''}`)),
            active && button('暂停阅读', () => work.run('暂停阅读', async () => update(await call('stop'))), { disabled: busy }),
            !active && ['paused', 'failed', 'partial'].includes(run.state) && button('继续本次阅读', () => work.run('继续阅读', async () => update(await call('start', { mode: tab, question: run.question }))), { disabled: busy }),
            run.question && h('p', null, '问题：' + run.question),
            notes.length > 0 && h('div', { className: 'ew-reader-notes' }, h('h4', null, `阅读草稿（${notes.length} 项，待核对）`), notes.slice(notePage * 20, notePage * 20 + 20).map((row, i) => h('article', { key: i }, row.type === 'fact' ? h('p', null, h('strong', null, row.name + '：'), row.value, ' ', row.unit, h('small', null, '条件：' + row.conditions)) : h('p', null, row.text), citations(row.citations))), h('div', { className: 'ew-inline' }, button('上一页笔记', () => setNotePage(notePage - 1), { disabled: !notePage }), h('span', null, `第 ${notePage + 1} / ${Math.ceil(notes.length / 20)} 页`), button('下一页笔记', () => setNotePage(notePage + 1), { disabled: (notePage + 1) * 20 >= notes.length }))),
            run.unresolved.length > 0 && h('details', null, h('summary', null, `未覆盖与待确认（${run.unresolved.length} 项）`), h(Bullets, { items: run.unresolved })))));
    }
