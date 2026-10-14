const { app, BrowserWindow, Menu, session, nativeTheme, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const option = (args, name) => args.find(s => s.startsWith('--' + name + '='))?.slice(name.length + 3);
const connectionFile = option(process.argv, 'workbench-connection');
const profile = option(process.argv, 'workbench-profile');
let request = option(process.argv, 'workbench-request');
if (!connectionFile || !profile || !path.isAbsolute(connectionFile) || !path.isAbsolute(profile)) {
  app.exit(1);
} else {
  fs.mkdirSync(profile, { recursive: true });
  app.setPath('userData', profile); app.setName('工程工作台'); app.setAppUserModelId('dsh.engineering-workbench.desktop');
  nativeTheme.themeSource = 'light';
  let window, connection, origin, quitting = false, heartbeat, failures = 0;
  const state = extra => fs.writeFileSync(path.join(profile, 'window-state.json'), JSON.stringify({
    pid: process.pid, request, port: connection?.port, electron: process.versions.electron,
    titlebarHeight: 40, titlebarColor: '#f9fafb', ...extra }));
  const fail = error => { fs.writeFileSync(path.join(profile, 'window-error.log'), new Date().toISOString() + ' ' + error.message); state({ failed: true }); app.exit(1); };
  async function connect() {
    const value = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      !/^[a-f0-9]{64}$/.test(value.key || '') || !/^engineering_workbench_[a-f0-9]+$/.test(value.cookieName || '')) throw new Error('Invalid workbench connection.');
    const next = 'http://127.0.0.1:' + value.port;
    await session.defaultSession.cookies.set({ url: next, name: value.cookieName, value: value.key, httpOnly: true, sameSite: 'strict', path: '/' });
    const changed = origin !== next; connection = value; origin = next; failures = 0;
    return changed;
  }
  const focus = () => { if (!window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); state({ ready: true, visible: true }); };
  const localAsset = url => { try { const parsed = new URL(url); return parsed.origin === origin && parsed.pathname === '/api/engineering-workbench/file'; } catch { return false; } };
  function protect(contents) {
    contents.on('will-attach-webview', e => e.preventDefault());
    const navigate = (e, url) => { try { if (new URL(url).origin !== origin) e.preventDefault(); } catch { e.preventDefault(); } };
    contents.on('will-navigate', navigate); contents.on('will-redirect', navigate);
    contents.setWindowOpenHandler(({ url }) => {
      if (localAsset(url)) {
        // Same session: PDF/SVG/report previews keep the authenticated local asset access.
        const preview = new BrowserWindow({ width: 1050, height: 780, title: '工程资料', backgroundColor: '#f9fafb', autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
        protect(preview.webContents); preview.loadURL(url);
      } else if (/^https?:\/\//i.test(url) && new URL(url).origin !== origin) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
  }
  if (!app.requestSingleInstanceLock()) app.exit(0);
  else {
    app.on('second-instance', (_event, argv) => {
      request = option(argv, 'workbench-request');
      app.whenReady().then(async () => { const changed = await connect(); if (changed) await window.loadURL(origin + '/api/engineering-workbench/page'); focus(); }).catch(fail);
    });
    app.on('before-quit', () => { quitting = true; clearTimeout(heartbeat); });
    app.on('activate', focus);
    app.whenReady().then(async () => {
      Menu.setApplicationMenu(null);
      session.defaultSession.setPermissionRequestHandler((_c, _p, reply) => reply(false));
      await connect();
      window = new BrowserWindow({ width: 1280, height: 850, minWidth: 640, minHeight: 520,
        show: false, title: '工程工作台', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#f9fafb',
        titleBarStyle: 'hidden', titleBarOverlay: { color: '#f9fafb', symbolColor: '#61666b', height: 40 }, autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
      protect(window.webContents);
      const visibility = () => window.webContents.send('workbench-visibility', window.isVisible() && !window.isMinimized());
      for (const event of ['show', 'hide', 'minimize', 'restore']) window.on(event, visibility);
      window.webContents.on('did-finish-load', visibility);
      window.on('close', e => { if (!quitting) { e.preventDefault(); window.hide(); state({ ready: true, visible: false }); } });
      window.once('ready-to-show', focus);
      await window.loadURL(origin + '/api/engineering-workbench/page');
      const check = async () => {
        try {
          const response = await fetch(origin + '/api/engineering-workbench/window-heartbeat', {
            headers: { cookie: connection.cookieName + '=' + connection.key }, signal: AbortSignal.timeout(2000) });
          if (!response.ok) throw new Error('Host disconnected'); failures = 0;
        } catch { failures++; }
        if (failures >= 3) { app.quit(); return; }
        if (!quitting) heartbeat = setTimeout(check, 2000);
      };
      heartbeat = setTimeout(check, 2000);
    }).catch(fail);
  }
}
