    const R = require('react');
    const h = R.createElement;
    const { useState, useEffect, useRef, useSyncExternalStore } = R;
    const statuses = { matches_listed_constraints: '满足已列条件', needs_confirmation: '资料待确认', incompatible: '不满足', pass: '满足', fail: '不满足', unknown: '待确认', checked: '局部检查符合', warning: '发现问题', not_applicable: '不适用' };
    const tone = value => ['matches_listed_constraints', 'pass', 'checked', 'done'].includes(value) ? 'good' : ['incompatible', 'fail', 'failed', 'warning'].includes(value) ? 'bad' : 'wait';
    const num = value => typeof value === 'number' ? Number(value.toFixed(1)).toLocaleString('zh-CN') : '—';
    const stamp = value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
    function Icon({ name, size = 18 }) {
      const shapes = {
        file: h('path', { d: 'M14 2H5v20h14V7zM14 2v6h5M8 13h8M8 17h6' }),
        globe: [h('circle', { key: 1, cx: 12, cy: 12, r: 9 }), h('path', { key: 2, d: 'M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18' })],
        database: [h('ellipse', { key: 1, cx: 12, cy: 5, rx: 8, ry: 3 }), h('path', { key: 2, d: 'M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0' })],
        plus: h('path', { d: 'M12 5v14M5 12h14' }),
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
      if (response.status === 401 || response.status === 403) throw new Error('工作台认证失效，请重新连接 DeepSeek Harness。');
      if (response.status === 404) throw new Error(`工作台接口 ${endpoint.split('?')[0]} 不可用（404）。请重新加载插件后端或重启 DeepSeek Harness，使前后端版本一致。`);
      let value;
      try { value = await response.json(); } catch { throw new Error(`工作台接口返回了无法识别的响应（${response.status}），请检查插件后端是否已加载。`); }
      if (!value || typeof value !== 'object') throw new Error('工作台接口响应格式不正确，请重新加载插件后端。');
      if (!response.ok || !value.ok) throw new Error(value.error || `请求失败 (${response.status})`);
      return value.value;
    }
