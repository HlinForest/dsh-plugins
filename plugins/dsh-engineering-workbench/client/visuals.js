    function PositionMap({ components, selected, onSelect }) {
      const items = components.filter(c => c.position);
      if (!items.length) return h('div', { className: 'ew-loading' }, '当前快照没有可定位的封装坐标。');
      const xs = items.map(c => c.position.x), ys = items.map(c => c.position.y);
      const x0 = Math.min(...xs) - 9, y0 = Math.min(...ys) - 9, w = Math.max(...xs) - x0 + 9, hg = Math.max(...ys) - y0 + 9;
      const radius = Math.max(w, hg) / 115;
      return h('svg', { className: 'ew-map', viewBox: `${x0} ${y0} ${w} ${hg}`, role: 'img', 'aria-label': '按实际封装坐标绘制的器件位置图' }, h('defs', null, h('pattern', { id: 'ew-grid', width: 5, height: 5, patternUnits: 'userSpaceOnUse' }, h('path', { d: 'M5 0H0V5', fill: 'none', stroke: '#295064', strokeWidth: .13 }))), h('rect', { x: x0, y: y0, width: w, height: hg, fill: 'url(#ew-grid)' }), items.map(c => {
        const x = c.position.x, y = 2 * y0 + hg - c.position.y;
        return h('g', { key: c.ref }, h('circle', { className: `ew-map-node${selected.includes(c.ref) ? ' selected' : ''}`, cx: x, cy: y, r: selected.includes(c.ref) ? radius * 1.5 : radius, role: 'button', tabIndex: 0, 'aria-label': `定位 ${c.ref} ${c.value}`, onClick: () => onSelect([c.ref]), onKeyDown: e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); onSelect([c.ref]); } } }, h('title', null, `${c.ref} ${c.value} (${num(x)}, ${num(c.position.y)}) mm`)), selected.includes(c.ref) && h('text', { x: x + radius * 2, y: y - radius * 2, style: { fontSize: radius * 2.2 } }, c.ref));
      }));
    }
    function Sheet({ view, parts = [], selected = [], focus }) {
      const box = focus ? `${Math.max(0, focus.at[0] - 24)} ${Math.max(0, focus.at[1] - 17)} 48 34` : `0 0 ${view.width} ${view.height}`;
      return h('svg', { viewBox: box, role: 'img', 'aria-label': focus ? `${focus.ref} 周围原生原理图` : 'KiCad 原生原理图预览' }, h('image', { href: view.url, width: view.width, height: view.height }), parts.filter(p => selected.includes(p.ref)).map(p => h('circle', { key: p.uuid, cx: p.at[0], cy: p.at[1], r: 4.5, fill: '#e3b54a22', stroke: '#b87527', strokeWidth: .3 })));
    }
    function Task({ task, now }) {
      const elapsed = ((task.finishedAt || now) - task.startedAt) / 1000;
      return h('article', { className: 'ew-task' }, h('div', { className: 'ew-task-title' }, h('div', null, h('strong', null, task.label), h('div', null, h('small', null, `${task.origin === 'chat' ? 'DSH 对话工具' : '工作台操作'} · ${stamp(task.startedAt)}`))), h('div', { className: 'ew-inline' }, chip(task.state === 'done' ? 'pass' : task.state === 'failed' ? 'fail' : '运行中'), h('small', null, `${num(elapsed)} s`))), task.steps.length > 0 && h('div', { className: 'ew-task-steps' }, task.steps.map((s, i) => h('span', { className: s.state, key: i }, s.state === 'done' ? h(Icon, { name: 'check', size: 14 }) : `${i + 1}.`, s.label))), task.error && h('div', { className: 'ew-task-error' }, task.error));
    }
