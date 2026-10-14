window.__ModuleLoader__.load({ id: 'dsh-eda-flow', factory: require => {
  const React = require('react'), h = React.createElement;
  function apply(ctx) {
    const slots = ctx.get('slots');
    function Entry() {
      const [opening, setOpening] = React.useState(false), [error, setError] = React.useState('');
      const [hovered, setHovered] = React.useState(false), [focused, setFocused] = React.useState(false);
      const tooltipId = React.useId();
      const open = async () => {
        if (opening) return; setOpening(true); setError('');
        try {
          const response = await fetch('/api/eda-flow/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'open-window' }) });
          const result = await response.json(); if (!result.ok) throw new Error(result.error);
        } catch (e) { setError(e.message); } finally { setOpening(false); }
      };
      const label = error ? `电路设计：${error}（点击重试）` : opening ? '正在打开电路设计…' : '电路设计 · 独立窗口';
      return h('span', { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false),
        style: { position: 'relative', display: 'inline-flex', flex: '0 0 40px', width: 40, height: 40, marginRight: 8, alignSelf: 'center' } },
        h('button', { type: 'button', onClick: open, disabled: opening, title: label, 'aria-label': '电路设计',
          'aria-busy': opening, 'aria-describedby': hovered || focused ? tooltipId : undefined,
          onFocus: () => setFocused(true), onBlur: () => setFocused(false),
          style: { display: 'grid', placeItems: 'center', flex: '0 0 40px', width: 40, height: 40,
            color: error ? '#da1e28' : 'inherit', background: hovered || focused ? 'rgba(38,49,72,.06)' : 'transparent',
            border: '1px solid transparent', borderRadius: 8, padding: 0,
            outline: focused ? '2px solid #4176e6' : 'none', outlineOffset: 2, cursor: opening ? 'wait' : 'pointer', opacity: opening ? .6 : 1 } },
          h('svg', { width: 20, height: 20, viewBox: '0 0 32 32', fill: 'currentColor', 'aria-hidden': true, focusable: false },
            h('path', { d: opening
              ? 'M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2Zm0 26a12 12 0 1 1 12-12 12 12 0 0 1-12 12Zm1-20h-2v9h8v-2h-6Z'
              : 'M28,18H22a2.0023,2.0023,0,0,0-2,2v2H14.4141L10,17.5859V12h2a2.0023,2.0023,0,0,0,2-2V4a2.0023,2.0023,0,0,0-2-2H6A2.0023,2.0023,0,0,0,4,4v6a2.0023,2.0023,0,0,0,2,2H8v5.5859L3.293,22.293a.9994.9994,0,0,0,0,1.414l5,5a.9995.9995,0,0,0,1.414,0L14.4141,24H20v2a2.0023,2.0023,0,0,0,2,2h6a2.0023,2.0023,0,0,0,2-2V20A2.0023,2.0023,0,0,0,28,18ZM6,4h6v6H6ZM9,26.5859,5.4141,23,9,19.4141,12.5859,23ZM22,26V20h6v6Z' }))),
        (hovered || focused) && h('span', { id: tooltipId, role: 'tooltip', style: { position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
          zIndex: 50, width: 'max-content', maxWidth: 260, padding: '8px 12px', borderRadius: 8,
          fontSize: 12, lineHeight: '18px', color: '#fff', background: '#262626', pointerEvents: 'none', overflowWrap: 'anywhere' } }, label),
        error && h('span', { role: 'alert', style: { position: 'absolute', width: 1, height: 1, padding: 0, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' } }, error));
    }
    slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'eda-flow.open', order: 14, label: () => '原理图与 PCB 流程' }, Entry));
  }
  return { name: 'eda-flow-client', inject: ['slots'], apply };
} });
