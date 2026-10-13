window.__ModuleLoader__.load({ id: 'dsh-eda-flow', factory: require => {
  const React = require('react'); const h = React.createElement;
  function apply(ctx) {
    const slots = ctx.get('slots'); let open = false; const listeners = new Set();
    const toggle = value => { open = value; for (const fn of listeners) fn(); };
    function useOpen() { return React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => open); }
    function Entry() { return h('button', { onClick: () => toggle(true), style: { padding: '8px 12px' } }, '原理图与 PCB 流程'); }
    function Window() {
      const visible = useOpen(); if (!visible) return null;
      return h('section', { style: { position: 'fixed', inset: 12, zIndex: 10000, background: '#fff', border: '1px solid #c5d6dc', borderRadius: 12, overflow: 'hidden', boxShadow: '0 18px 70px #1234' } },
        h('button', { onClick: () => toggle(false), 'aria-label': '关闭工程流程', style: { position: 'absolute', right: 18, top: 12, zIndex: 2, border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer' } }, '关闭'),
        h('iframe', { src: '/api/eda-flow/page', title: '原理图与 PCB 流程', style: { width: '100%', height: '100%', border: 0 } }));
    }
    slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'eda-flow.open', order: 14, label: () => '原理图与 PCB 流程' }, Entry));
    slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'eda-flow.window', order: 32 }, Window));
  }
  return { name: 'eda-flow-client', inject: ['slots'], apply };
} });
