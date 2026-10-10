    const invoke = (group, action, args = {}, confirmation) => api('action', { group, action, args, ...(confirmation ? { confirmation } : {}) });
    function useWork() {
      const [busy, setBusy] = useState(''), [error, setError] = useState('');
      const lock = useRef(false);
      const run = async (label, fn) => {
        if (lock.current) return null;
        lock.current = true; setBusy(label); setError('');
        try { return await fn(); } catch (e) { setError(e.message); return null; }
        finally { lock.current = false; setBusy(''); }
      };
      return { busy, error, setError, run };
    }
    function Alert({ work }) { return h(R.Fragment, null, work.error && h('div', { className: 'ew-error', role: 'alert' }, work.error), work.busy && h('p', { className: 'ew-note', role: 'status' }, work.busy + '…')); }
    function Field({ label, children, hint }) {
      const id = R.useId();
      return h('div', { className: 'ew-field' }, h('label', { htmlFor: id }, label), R.isValidElement(children) ? R.cloneElement(children, { id, 'aria-label': label }) : children, hint && h('small', null, hint));
    }
    const textInput = (value, setter, props = {}) => h('input', { type: 'text', value, onChange: e => setter(e.target.value), ...props });
    const textarea = (value, setter, props = {}) => h('textarea', { value, onChange: e => setter(e.target.value), rows: 5, ...props });
    const selectInput = (value, setter, options, props = {}) => h('select', { value, onChange: e => setter(e.target.value), ...props }, options.map(o => h('option', { key: Array.isArray(o) ? o[0] : o, value: Array.isArray(o) ? o[0] : o }, Array.isArray(o) ? o[1] : o)));
    const checkbox = (label, value, setter, props = {}) => h('label', { className: 'ew-checkbox' }, h('input', { type: 'checkbox', checked: value, onChange: e => setter(e.target.checked), ...props }), label);
    const empty = text => h('p', { className: 'ew-empty' }, text);
    const compact = value => value === null || value === undefined ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    function Table({ columns, rows, rowKey }) {
      return h('div', { className: 'ew-table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, columns.map((c, i) => h('th', { key: i }, c[0])))),
        h('tbody', null, rows.map((r, i) => h('tr', { key: rowKey ? rowKey(r) : i }, columns.map((c, j) => h('td', { key: j }, typeof c[1] === 'function' ? c[1](r, i) : compact(r[c[1]]))))))));
    }
    function Raw({ value, title = '查看完整数据' }) { return h('details', { className: 'ew-raw' }, h('summary', null, title), h('pre', null, JSON.stringify(value, null, 2))); }
    function Artifacts({ value }) {
      const names = { htmlPath: '打开 HTML 报告', jsonPath: '下载 JSON 报告', markdownPath: '下载 Markdown 报告', json: '下载 JSON 报告', markdown: '下载 Markdown 报告', pdf: '候选 PDF', report: '校验记录', candidate: '下载候选原理图' };
      return h('div', { className: 'ew-artifacts' }, (value?.artifacts ?? []).filter(a => a.key !== 'preview').map(a => h('a', { key: a.url, href: a.url, target: '_blank', rel: 'noopener noreferrer', download: a.key === 'candidate' ? a.name : undefined }, names[a.key] || a.name)));
    }
    function Bullets({ items }) { return items?.length ? h('ul', { className: 'ew-bullets' }, items.map((x, i) => h('li', { key: i }, compact(x)))) : null; }
    function TextReport({ text }) {
      return h('div', { className: 'ew-text-report' }, String(text || '').split(/\n{2,}/).map((part, i) => {
        if (/^#{1,4} /.test(part) && !part.includes('\n')) return h('h3', { key: i }, part.replace(/^#+ /, ''));
        if (part.startsWith('|')) {
          const rows = part.split('\n').filter(line => !/^\|[\s:|-]+$/.test(line)).map(line => line.split(/(?<!\\)\|/).slice(1, -1).map(s => s.trim().replace(/\\([|_*])/g, '$1')));
          if (rows.length) return h(Table, { key: i, columns: rows[0].map((c, j) => [c, r => r[j]]), rows: rows.slice(1) });
        }
        return h('p', { key: i, style: { whiteSpace: 'pre-wrap' } }, part);
      }));
    }
    function FilePicker({ value, onChange, label, extensions }) {
      const [opened, setOpened] = useState(false), [listing, setListing] = useState(null), [error, setError] = useState('');
      const browse = async dir => { try { setListing(await api('files?directory=' + encodeURIComponent(dir))); setError(''); } catch (e) { setError(e.message); } };
      return h('div', { className: 'ew-path-field' }, h(Field, { label }, textInput(value, onChange, { placeholder: '选择文件或输入工程目录内的路径' })), button(opened ? '关闭文件列表' : '选择文件', () => { if (!opened) browse(''); setOpened(!opened); }), opened && h('div', { className: 'ew-filepicker' },
        error && h('p', { role: 'alert' }, error), listing && h(R.Fragment, null, h('p', { className: 'ew-help' }, listing.root, listing.directory ? '/' + listing.directory : ''), listing.parent !== null && button('上级目录', () => browse(listing.parent)),
          h('ul', null, listing.entries.filter(f => f.directory || !extensions || extensions.some(ext => f.name.toLowerCase().endsWith(ext))).map(f => h('li', { key: f.path }, button((f.directory ? '文件夹 · ' : '') + f.name, () => { if (f.directory) browse(f.relative); else { onChange(f.path); setOpened(false); } })))), listing.truncated && h('small', null, '本目录仅显示前 400 项，可输入确切路径。'))));
    }
    function ConstraintEditor({ fields, value, onChange, disabled }) {
      const update = (i, patch) => onChange(value.map((row, j) => j === i ? { ...row, ...patch } : row));
      return h('div', { className: 'ew-supplements' }, value.map((row, i) => {
        const spec = fields[row.field] || { kind: 'number', unit: '' };
        return h('fieldset', { key: i, disabled, className: 'ew-form-row' }, h('legend', null, `补充条件 ${i + 1}`),
          h(Field, { label: '参数' }, selectInput(row.field, field => update(i, { field, operator: fields[field]?.kind === 'list' ? 'includes' : 'eq' }), Object.entries(fields).map(([k, v]) => [k, v.label]))),
          h(Field, { label: '关系' }, selectInput(row.operator, operator => update(i, { operator }), spec.kind === 'number' ? [['gte', '不少于'], ['lte', '不超过'], ['eq', '等于'], ['range', '范围']] : spec.kind === 'list' ? [['includes', '包含']] : [['eq', '等于']])),
          h(Field, { label: `要求值${spec.unit ? '（' + spec.unit + '）' : ''}` }, textInput(row.input || '', input => update(i, { input }), { placeholder: row.operator === 'range' ? '下限,上限' : '明确值', required: true })),
          h(Field, { label: '逐字原文依据' }, textInput(row.sourceQuote || '', sourceQuote => update(i, { sourceQuote }), { required: true })),
          checkbox('硬条件', row.hard !== false, hard => update(i, { hard })), button('删除条件', () => onChange(value.filter((_, j) => j !== i)))) ;
      }), button('添加补充条件', () => onChange([...value, { field: 'output_power_w', operator: 'gte', input: '', sourceQuote: '', hard: true }]), { disabled }));
    }
    function constraintArgs(rows, fields) {
      return rows.map(r => {
        const base = { field: r.field, operator: r.operator, hard: r.hard !== false, sourceQuote: r.sourceQuote };
        if (fields[r.field]?.kind !== 'number') return { ...base, textValue: r.input };
        if (r.operator === 'range') { const pair = r.input.split(/[,，]/).map(s => s.trim()); if (pair.length !== 2 || pair.some(s => !s || !Number.isFinite(Number(s)))) throw new Error('范围请填写两个数值，例如 180,264。'); return { ...base, min: Number(pair[0]), max: Number(pair[1]) }; }
        if (!r.input?.trim() || !Number.isFinite(Number(r.input))) throw new Error('补充条件需要有效数值。');
        return { ...base, value: Number(r.input) };
      });
    }
