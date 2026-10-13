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
      const visible = useOpen(); const panel = React.useRef(null); const frame = React.useRef(null);
      const [mounted, setMounted] = React.useState(false);
      React.useEffect(() => { if (visible) setMounted(true); }, [visible]);
      React.useEffect(() => {
        if (!panel.current) return;
        if (visible && !panel.current.matches(':popover-open')) panel.current.showPopover();
        else if (!visible && panel.current.matches(':popover-open')) panel.current.hidePopover();
      }, [visible, mounted]);
      React.useEffect(() => {
        const element = panel.current;
        if (!element) return;
        // Light dismissal leaves the initiating host click intact and keeps the iframe alive.
        const dismissed = () => { if (!element.matches(':popover-open')) toggle(false); };
        element.addEventListener('toggle', dismissed);
        return () => element.removeEventListener('toggle', dismissed);
      }, [mounted]);
      React.useEffect(() => {
        const receive = event => {
          // Only our own frame can close this window; no workbench or host state is changed.
          if (event.source === frame.current?.contentWindow && event.data?.type === 'eda-flow:close') toggle(false);
        };
        window.addEventListener('message', receive);
        return () => window.removeEventListener('message', receive);
      }, []);
      if (!mounted) return null;
      return h('section', { ref: panel, popover: 'auto', role: 'region', 'data-eda-flow-window': '', 'aria-label': '原理图与 PCB 流程',
          style: { position: 'fixed', top: 48, right: 12, bottom: 12, left: 'auto', margin: 0, padding: 0, width: 'min(980px, calc(100vw - 24px))', height: 'calc(100dvh - 60px)', maxWidth: 'none', maxHeight: 'none', border: '1px solid #d4d1c9', borderRadius: 8, overflow: 'hidden', background: '#f5f4f1', boxShadow: '0 8px 32px #29272424', WebkitAppRegion: 'no-drag' } },
          h('iframe', { ref: frame, src: '/api/eda-flow/page?embedded=1', title: '原理图与 PCB 流程',
            style: { display: 'block', width: '100%', height: '100%', border: 0, background: '#f5f4f1' } }));
    }
    slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'eda-flow.open', order: 14, label: () => '原理图与 PCB 流程' }, Entry));
    slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'eda-flow.window', order: 32 }, Window));
  }
  return { name: 'eda-flow-client', inject: ['slots'], apply };
} });
