    const R = require('react');
    const h = R.createElement;
    const { useState, useEffect, useRef, useSyncExternalStore } = R;
    const statuses = { matches_listed_constraints: '满足已列条件', needs_confirmation: '资料待确认', incompatible: '不满足', pass: '满足', fail: '不满足', unknown: '待确认', checked: '局部检查符合', warning: '发现问题', not_applicable: '不适用' };
    const tone = value => ['matches_listed_constraints', 'pass', 'checked', 'done'].includes(value) ? 'good' : ['incompatible', 'fail', 'failed', 'warning'].includes(value) ? 'bad' : 'wait';
    const num = value => typeof value === 'number' ? Number(value.toFixed(1)).toLocaleString('zh-CN') : '—';
    const stamp = value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
    function Icon({ name, size = 18 }) {
      const shapes = {
        grid: [h('rect', { key: 1, x: 3, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { key: 2, x: 14, y: 3, width: 7, height: 7, rx: 1 }), h('rect', { key: 3, x: 3, y: 14, width: 7, height: 7, rx: 1 }), h('path', { key: 4, d: 'M14 17h7M17.5 13.5v7' })],
        power: h('path', { d: 'M13 2 4 14h7l-1 8 10-13h-8z' }),
        circuit: [h('rect', { key: 1, x: 6, y: 6, width: 12, height: 12, rx: 2 }), h('path', { key: 2, d: 'M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4' })],
        activity: h('path', { d: 'M2 12h4l3-8 5 16 3-8h5' }),
        close: h('path', { d: 'm6 6 12 12M6 18 18 6' }),
        arrow: h('path', { d: 'M4 12h16m-6-6 6 6-6 6' }),
        check: h('path', { d: 'm5 12 4 4L19 6' }),
      };
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, shapes[name] || shapes.grid);
    }
    const chip = value => h('span', { className: `ew-chip ${tone(value)}` }, statuses[value] || value);
    const button = (text, onClick, props = {}) => h('button', { type: 'button', onClick, ...props }, text);
    const link = (text, href) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', className: 'ew-link' }, text);
    async function api(endpoint, body) {
      const response = await fetch(`/api/engineering-workbench/${endpoint}`, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok || !value.ok) throw new Error(value.error || `请求失败 (${response.status})`);
      return value.value;
    }
