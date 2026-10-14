window.__ModuleLoader__.load({ id: 'dsh-engineering-workbench', factory: require => {
  const React = require('react'), h = React.createElement;
  function apply(ctx) {
    const slots = ctx.get('slots');
    function Entry() {
      const [opening, setOpening] = React.useState(false), [error, setError] = React.useState('');
      const [hovered, setHovered] = React.useState(false), [focused, setFocused] = React.useState(false);
      const tooltipId = React.useId();
      const [webUrl, setWebUrl] = React.useState('');
      const open = async () => {
        if (opening) return; setOpening(true); setError('');
        try {
          const response = await fetch('/api/engineering-workbench/open-window', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'open-window' }) });
          if (response.status === 404) throw new Error('工作台后端尚未更新，请重新加载插件或在方便时重启 Harness。');
          if (response.status === 401 || response.status === 403) throw new Error('工作台连接已失效，请重新打开 Harness。');
          const result = await response.json(); if (!result.ok) throw new Error(result.error);
          if (result.value?.mode === 'web') { const target = window.open(result.value.url, 'engineering-workbench'); if (!target) { setWebUrl(result.value.url); } else { target.focus(); } }
        } catch (e) { setError(e.message); } finally { setOpening(false); }
      };
      const label = error ? `工程工作台：${error}（点击重试）` : opening ? '正在打开工程工作台…' : '工程工作台 · 独立窗口';
      return h('span', { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false),
        style: { position: 'relative', display: 'inline-flex', flex: '0 0 40px', width: 40, height: 40, marginRight: 8, alignSelf: 'center' } },
        h('button', { type: 'button', onClick: open, disabled: opening, title: label, 'aria-label': '工程工作台',
          'aria-busy': opening, 'aria-describedby': hovered || focused ? tooltipId : undefined,
          onFocus: () => setFocused(true), onBlur: () => setFocused(false),
          style: { display: 'grid', placeItems: 'center', flex: '0 0 40px', width: 40, height: 40,
            color: error ? '#da1e28' : 'inherit', background: hovered || focused ? 'rgba(38,49,72,.06)' : 'transparent',
            border: '1px solid transparent', borderRadius: 8, padding: 0,
            outline: focused ? '2px solid #4176e6' : 'none', outlineOffset: 2, cursor: opening ? 'wait' : 'pointer', opacity: opening ? .6 : 1 } },
          h('svg', { width: 20, height: 20, viewBox: '0 0 32 32', fill: 'currentColor', 'aria-hidden': true, focusable: false },
            h('path', { d: opening
              ? 'M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2Zm0 26a12 12 0 1 1 12-12 12 12 0 0 1-12 12Zm1-20h-2v9h8v-2h-6Z'
              : 'M4 4h10v10H4V4Zm2 2v6h6V6H6Zm12-2h10v10H18V4Zm2 2v6h6V6h-6ZM4 18h10v10H4V18Zm2 2v6h6v-6H6Zm16-2h2v4h4v2h-4v4h-2v-4h-4v-2h4v-4Z' }))),
        (hovered || focused) && h('span', { id: tooltipId, role: 'tooltip', style: { position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
          zIndex: 50, width: 'max-content', maxWidth: 260, padding: '8px 12px', borderRadius: 8,
          fontSize: 12, lineHeight: '18px', color: '#fff', background: '#262626', pointerEvents: 'none', overflowWrap: 'anywhere' } }, label),
        webUrl && h('a', { href: webUrl, target: 'engineering-workbench', style: { position: 'absolute', bottom: 48, left: 0, whiteSpace: 'nowrap', padding: 8, borderRadius: 8, background: '#fff', color: '#4176e6' } }, '打开工程工作台'),
        error && h('span', { role: 'alert', style: { position: 'absolute', width: 1, height: 1, padding: 0, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } }, error));
    }
    slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'engineering-workbench.open', order: 15, label: () => '工程工作台' }, Entry));
  }
  return { name: 'engineering-workbench-client', inject: ['slots'], apply };
} });
