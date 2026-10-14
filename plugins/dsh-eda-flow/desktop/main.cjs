const { app, BrowserWindow, Menu, session, nativeTheme, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const connectionFile = option('eda-connection');
const profileDirectory = option('eda-profile');
if (!connectionFile || !profileDirectory || !path.isAbsolute(connectionFile) || !path.isAbsolute(profileDirectory)) {
  console.error('The design window needs a local Harness connection and its own profile.');
  app.exit(1);
} else {
  fs.mkdirSync(profileDirectory, { recursive: true });
  app.setPath('userData', profileDirectory);
  app.setName('电路设计');
  app.setAppUserModelId('dsh.eda-flow.desktop');
  nativeTheme.themeSource = 'light';
  let window, origin;

  function readConnection() {
    const value = JSON.parse(fs.readFileSync(connectionFile, 'utf8'));
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
        !/^[a-f0-9]{64}$/.test(value.key || '') || !/^eda_flow_[a-f0-9]+$/.test(value.cookieName || '')) {
      throw new Error('Invalid local design-window connection.');
    }
    return value;
  }
  function writeState(extra = {}) {
    fs.writeFileSync(path.join(profileDirectory, 'window-state.json'), JSON.stringify({
      pid: process.pid, electron: process.versions.electron, titlebarHeight: 40,
      titlebarColor: '#f9fafb', port: origin ? Number(new URL(origin).port) : null, ...extra,
    }));
  }
  function fail(error) {
    fs.writeFileSync(path.join(profileDirectory, 'window-error.log'), `${new Date().toISOString()} ${error.message}\n`);
    writeState({ failed: true });
    app.exit(1);
  }
  async function connect() {
    const value = readConnection();
    const next = `http://127.0.0.1:${value.port}`;
    await session.defaultSession.cookies.set({ url: next, name: value.cookieName, value: value.key,
      httpOnly: true, sameSite: 'strict', path: '/' });
    const changed = origin !== next;
    origin = next;
    return changed;
  }
  function focus() {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    writeState({ ready: true });
  }
  if (!app.requestSingleInstanceLock()) {
    app.exit(0);
  } else {
    app.on('second-instance', () => {
      app.whenReady().then(async () => {
        const changed = await connect();
        if (changed && window) await window.loadURL(`${origin}/api/eda-flow/page`);
        focus();
      }).catch(fail);
    });
    app.on('window-all-closed', () => app.quit());
    app.on('activate', focus);
    app.whenReady().then(async () => {
      Menu.setApplicationMenu(null);
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
      await connect();
      window = new BrowserWindow({
        width: 1280, height: 850, minWidth: 640, minHeight: 520,
        show: false, title: '电路设计', icon: path.join(__dirname, 'icon.png'),
        backgroundColor: '#f9fafb', titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#f9fafb', symbolColor: '#61666b', height: 40 },
        autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
      });
      window.webContents.setWindowOpenHandler(({ url }) => {
        // External documents open in the user's browser, never in a privileged app window.
        if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
        return { action: 'deny' };
      });
      const keepLocal = (event, url) => {
        if (new URL(url).origin !== origin) event.preventDefault();
      };
      window.webContents.on('will-navigate', keepLocal);
      window.webContents.on('will-redirect', keepLocal);
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      window.once('ready-to-show', () => { focus(); writeState({ ready: true }); });
      window.on('closed', () => { window = null; writeState({ closed: true }); });
      await window.loadURL(`${origin}/api/eda-flow/page`);
    }).catch(fail);
  }
}
