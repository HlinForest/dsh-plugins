window.__ModuleLoader__.load({ id: 'dsh-eda-flow', factory: require => {
  const React = require('react'); const h = React.createElement;
  function apply(ctx) {
    const slots = ctx.get('slots'); let open = false; const listeners = new Set();
    const toggle = value => { open = value; for (const fn of listeners) fn(); };
    function useOpen() { return React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => open); }
    function Entry() {
      return h('button', { onClick: () => toggle(true), title: '原理图与 PCB 流程', 'aria-label': '原理图与 PCB 流程',
        style: { font: 'inherit', fontSize: 13, lineHeight: '20px', color: 'inherit', background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '8px 10px', whiteSpace: 'nowrap', flex: '0 0 auto', cursor: 'pointer' } }, '电路设计');
    }
    function Window() {
      const visible = useOpen(); const dialog = React.useRef(null); const frame = React.useRef(null);
      const [mounted, setMounted] = React.useState(false);
      React.useEffect(() => { if (visible) setMounted(true); }, [visible]);
      React.useEffect(() => {
        if (!dialog.current) return;
        if (visible && !dialog.current.open) dialog.current.showModal();
        else if (!visible && dialog.current.open) dialog.current.close();
      }, [visible, mounted]);
      React.useEffect(() => {
        const receive = event => {
          // Only our own frame can close this window; no workbench or host state is changed.
          if (event.source === frame.current?.contentWindow && event.data?.type === 'eda-flow:close') toggle(false);
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
      }, []);
      if (!mounted) return null;
      return h(React.Fragment, null,
        h('style', null, '[data-eda-flow-window]::backdrop{background:rgba(20,35,48,.32)}'),
        h('dialog', { ref: dialog, 'data-eda-flow-window': '', 'aria-label': '原理图与 PCB 流程',
          onCancel: event => { event.preventDefault(); toggle(false); }, onClose: () => { if (!dialog.current?.open) toggle(false); },
          style: { position: 'fixed', inset: '44px 12px 12px', margin: 0, padding: 0, width: 'calc(100vw - 24px)', height: 'calc(100dvh - 56px)', maxWidth: 'none', maxHeight: 'none', border: '1px solid #cad6df', borderRadius: 10, overflow: 'hidden', background: '#f5f7f9', boxShadow: '0 20px 80px #12233340', WebkitAppRegion: 'no-drag' } },
          h('iframe', { ref: frame, src: '/api/eda-flow/page?embedded=1', title: '原理图与 PCB 流程',
            style: { display: 'block', width: '100%', height: '100%', border: 0, background: '#f5f7f9' } })));
    }
    slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'eda-flow.open', order: 14, label: () => '原理图与 PCB 流程' }, Entry));
    slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'eda-flow.window', order: 32 }, Window));
  }
  return { name: 'eda-flow-client', inject: ['slots'], apply };
} });
