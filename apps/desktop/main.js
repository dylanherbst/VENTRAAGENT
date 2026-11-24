// AiMoneyPrinter desktop app: a thin, locked-down window around the hosted web app. It holds no keys and no business logic;
// everything runs on the server. Set AIMP_APP_URL (see README) to the deployed address, or run the web app locally for development.
'use strict';
const { app, BrowserWindow, shell, session, Menu } = require('electron');
const path = require('node:path');
const { appOrigin, classify } = require('./navigation.js');

const START = process.env.AIMP_APP_URL || 'http://localhost:3000/app';
const origin = appOrigin(START);
if (!origin) { console.error('AIMP_APP_URL must be an https address (http is only allowed for localhost).'); app.exit(1); }

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600, backgroundColor: '#ffffff', title: 'AiMoneyPrinter',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, preload: path.join(__dirname, 'preload.js') },
  });
  const guard = (event, url) => {
    const c = classify(url, origin);
    if (c === 'inside') return;
    event.preventDefault();
    if (c === 'external') shell.openExternal(url);
  };
  win.webContents.on('will-navigate', guard);
  win.webContents.setWindowOpenHandler(({ url }) => { if (classify(url, origin) === 'external') shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(START);
}

app.whenReady().then(() => {
  // No camera, microphone, location or notifications unless a later feature asks for them on purpose.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('second-instance', () => { const [w] = BrowserWindow.getAllWindows(); if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
