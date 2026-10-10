    function PositionMap({ components, selected, onSelect }) {
      const items = components.filter(c => c.position);
      if (!items.length) return h('div', { className: 'ew-loading' }, '当前快照没有可定位的封装坐标。');
      const xs = items.map(c => c.position.x), ys = items.map(c => c.position.y);
      const x0 = Math.min(...xs) - 9, y0 = Math.min(...ys) - 9, w = Math.max(...xs) - x0 + 9, hg = Math.max(...ys) - y0 + 9;
      const radius = Math.max(w, hg) / 115;
      return h('svg', { className: 'ew-map', viewBox: `${x0} ${y0} ${w} ${hg}`, role: 'group', 'aria-label': '按实际封装坐标绘制的器件位置图', onClick: () => onSelect([]), onKeyDown: e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onSelect([]); } } }, h('defs', null, h('pattern', { id: 'ew-grid', width: 5, height: 5, patternUnits: 'userSpaceOnUse' }, h('path', { d: 'M5 0H0V5', fill: 'none', stroke: '#295064', strokeWidth: .13 }))), h('rect', { x: x0, y: y0, width: w, height: hg, fill: 'url(#ew-grid)' }), items.map(c => {
        const x = c.position.x, y = 2 * y0 + hg - c.position.y;
        return h('g', { key: c.ref, onClick: e => { e.stopPropagation(); onSelect([c.ref]); } },
          h('circle', { className: `ew-map-node${selected.includes(c.ref) ? ' selected' : ''}`, cx: x, cy: y, r: selected.includes(c.ref) ? radius * 1.5 : radius, role: 'button', tabIndex: 0, 'aria-pressed': selected.includes(c.ref), 'aria-label': `定位 ${c.ref} ${c.value}`, onKeyDown: e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); onSelect([c.ref]); } } }, h('title', null, `${c.ref} ${c.value} (${num(x)}, ${num(c.position.y)}) mm`)),
          h('circle', { className: 'ew-map-focus', cx: x, cy: y, r: radius * 2.1, 'aria-hidden': true }),
          selected.includes(c.ref) && h('text', { x: x + radius * 2.5, y: y - radius * 2.5, style: { fontSize: radius * 2.2 } }, c.ref));
      }));
    }
    function Sheet({ view, parts = [], selected = [], focus, box, marks = [], side = 'after' }) {
      const frame = box || (focus ? `${Math.max(0, focus.at[0] - 24)} ${Math.max(0, focus.at[1] - 17)} 48 34` : `0 0 ${view.width} ${view.height}`);
      return h('svg', { viewBox: frame, role: 'img', 'aria-label': focus ? `${focus.ref} 周围原生原理图` : '图纸预览', className: 'ew-sheet' },
        h('image', { href: view.url, width: view.width, height: view.height }),
        parts.filter(p => selected.includes(p.ref)).map(p => h('circle', { key: p.uuid, cx: p.at[0], cy: p.at[1], r: 4.5, fill: '#e3b54a22', stroke: '#b87527', strokeWidth: .3 })),
        marks.filter(Boolean).map((m, i) => h('g', { key: i, className: 'ew-change-mark ' + side }, m.kind === 'wire' || m.kind === 'bus' || m.kind === 'polyline'
          ? h('polyline', { points: m.points.map(p => p.join(',')).join(' '), fill: 'none' })
          : h('circle', { cx: m.points[0][0], cy: m.points[0][1], r: m.kind === 'symbol' ? 5 : 2.5 }))));
    }
    function drawingFrame(view, points) {
      if (!points?.length) return { x: 0, y: 0, w: view.width, h: view.height };
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const w = Math.max(64, Math.max(...xs) - Math.min(...xs) + 40), height = Math.max(48, Math.max(...ys) - Math.min(...ys) + 20);
      return { x: (Math.min(...xs) + Math.max(...xs) - w) / 2, y: (Math.min(...ys) + Math.max(...ys) - height) / 2, w, h: height };
    }
    function DrawingViewer({ panes, focusKey = '', title = '图纸查看器' }) {
      const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 }), [full, setFull] = useState(false), [overview, setOverview] = useState(false);
      const container = useRef(null), area = useRef(null), drag = useRef(null), expand = useRef(null), close = useRef(null);
      const reset = () => setCamera({ zoom: 1, x: 0, y: 0 });
      const zoom = factor => setCamera(c => ({ ...c, zoom: Math.max(1, Math.min(12, c.zoom * factor)) }));
      useEffect(() => { reset(); setOverview(false); }, [focusKey]);
      useEffect(() => {
        const el = area.current;
        const wheel = e => { e.preventDefault(); zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
        el.addEventListener('wheel', wheel, { passive: false });
        return () => el.removeEventListener('wheel', wheel);
      }, []);
      useEffect(() => { if (full) close.current?.focus(); }, [full]);
      const leave = () => { setFull(false); setTimeout(() => expand.current?.focus(), 0); };
      const keyDown = e => {
        if (e.key === 'Escape' && full) { e.preventDefault(); e.stopPropagation(); leave(); }
        if (e.key === 'Tab' && full) {
          const buttons = [...container.current.querySelectorAll('button:not(:disabled),[tabindex="0"]')];
          if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1).focus(); }
          else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0].focus(); }
        }
      };
      return h('section', { ref: container, className: 'ew-drawing-viewer' + (full ? ' ew-drawing-full' : ''), role: full ? 'dialog' : 'region', 'aria-label': title, 'aria-modal': full || undefined, onKeyDown: keyDown },
        h('div', { className: 'ew-drawing-toolbar' }, h('strong', null, title),
          h('div', { className: 'ew-inline' }, button('−', () => zoom(1 / 1.25), { 'aria-label': '缩小图纸', disabled: camera.zoom <= 1 }), h('output', { 'aria-label': '图纸缩放比例' }, Math.round(camera.zoom * 100) + '%'), button('+', () => zoom(1.25), { 'aria-label': '放大图纸', disabled: camera.zoom >= 12 }),
            button('适合窗口', reset), button(overview ? '回到所选变化' : '整张图纸', () => { setOverview(!overview); reset(); }, { disabled: !panes.some(p => p.points?.length) }),
            full ? button('退出全屏', leave, { ref: close }) : button('全屏查看', () => setFull(true), { ref: expand }))),
        h('p', { className: 'ew-help' }, '滚轮缩放，拖动平移；双击放大。前后图同步缩放与平移。'),
        h('div', { className: 'ew-drawing-area', ref: area, style: { '--panes': panes.length } }, panes.map(p => {
          const base = drawingFrame(p.view, overview ? null : p.points), c = camera;
          const box = `${base.x + base.w * ((1 - 1 / c.zoom) / 2 + c.x)} ${base.y + base.h * ((1 - 1 / c.zoom) / 2 + c.y)} ${base.w / c.zoom} ${base.h / c.zoom}`;
          return h('div', { key: p.id, className: 'ew-drawing-pane' }, h('header', null, p.title),
            h('div', { className: 'ew-drawing-stage', tabIndex: 0, 'aria-label': p.title + '，可缩放和平移', onDoubleClick: () => zoom(1.5),
              onKeyDown: e => { if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); if (['+', '='].includes(e.key)) zoom(1.25); else if (e.key === '-') zoom(1 / 1.25); else if (e.key === '0') reset(); else setCamera(c => ({ ...c, x: c.x + (e.key === 'ArrowLeft' ? -.08 : e.key === 'ArrowRight' ? .08 : 0) / c.zoom, y: c.y + (e.key === 'ArrowUp' ? -.08 : e.key === 'ArrowDown' ? .08 : 0) / c.zoom })); } },
              onPointerDown: e => { if (e.button !== 0) return; e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); const rect = e.currentTarget.getBoundingClientRect(); const scale = Math.min(rect.width / base.w, rect.height / base.h) * camera.zoom; drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, camera, scale, base }; },
              onPointerMove: e => { const d = drag.current; if (d?.pointer === e.pointerId) setCamera({ ...d.camera, x: d.camera.x - (e.clientX - d.x) / d.scale / d.base.w, y: d.camera.y - (e.clientY - d.y) / d.scale / d.base.h }); }, onPointerUp: () => { drag.current = null; }, onPointerCancel: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; } },
              h(Sheet, { view: p.view, box, marks: p.marks, side: p.id })));
        })));
    }
    function Task({ task, now }) {
      const elapsed = ((task.finishedAt || now) - task.startedAt) / 1000;
      return h('article', { className: 'ew-task' }, h('div', { className: 'ew-task-title' }, h('div', null, h('strong', null, task.label), h('div', null, h('small', null, `${task.origin === 'chat' ? 'DSH 对话工具' : '工作台操作'} · ${stamp(task.startedAt)}`))), h('div', { className: 'ew-inline' }, chip(task.state === 'done' ? 'pass' : task.state === 'failed' ? 'fail' : '运行中'), h('small', null, `${num(elapsed)} s`))), task.steps.length > 0 && h('div', { className: 'ew-task-steps' }, task.steps.map((s, i) => h('span', { className: s.state, key: i }, s.state === 'done' ? h(Icon, { name: 'check', size: 14 }) : `${i + 1}.`, s.label))), task.error && h('div', { className: 'ew-task-error' }, task.error));
    }
