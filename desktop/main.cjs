// IMPACTO HEADSOFTWARE · app desktop (macOS)
// Sobe o servidor Next (standalone) dentro do app e abre uma janela com vidro nativo do macOS.
const { app, BrowserWindow, shell, nativeTheme, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.IHS_PORT || 3741);
const DEV_URL = process.env.IHS_DEV_URL || '';
let server = null;
let win = null;

const userData = () => app.getPath('userData');

/** Lê variáveis do arquivo .env na pasta de dados do app (gravado pelo instalador) ou do .env.local do projeto. */
function loadEnv() {
  const candidates = [path.join(userData(), '.env'), path.join(__dirname, '..', '.env.local'), path.join(__dirname, '..', '.env')];
  const env = {};
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    break;
  }
  return env;
}

function waitFor(url, tries = 120) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      http
        .get(url, (res) => {
          res.resume();
          resolve(true);
        })
        .on('error', () => (n <= 0 ? reject(new Error('Servidor não respondeu')) : setTimeout(() => tick(n - 1), 500)));
    };
    tick(tries);
  });
}

async function startServer() {
  if (DEV_URL) return DEV_URL;
  const base = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..', '.next', 'standalone');
  const serverJs = path.join(base, 'server.js');
  if (!fs.existsSync(serverJs)) {
    dialog.showErrorBox('IMPACTO HEADSOFTWARE', 'Build do app não encontrado. Rode "npm run build" na pasta do projeto ou use o instalador.');
    app.quit();
    return null;
  }
  const dataDir = path.join(userData(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const env = {
    ...process.env,
    ...loadEnv(),
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOSTNAME: '127.0.0.1',
    IHS_DATA_DIR: dataDir,
    IHS_DESKTOP: '1',
  };
  server = spawn(process.execPath, [serverJs], { env, cwd: base, stdio: 'inherit' });
  server.on('exit', (code) => {
    server = null;
    if (code && win) dialog.showErrorBox('IMPACTO HEADSOFTWARE', `O servidor interno parou (código ${code}).`);
  });
  await waitFor(`http://127.0.0.1:${PORT}/api/health`);
  return `http://127.0.0.1:${PORT}`;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'IMPACTO HEADSOFTWARE',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    transparent: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  nativeTheme.themeSource = 'dark';
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (u.startsWith('http') && !u.startsWith(url)) shell.openExternal(u);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, u) => {
    if (!u.startsWith(url)) {
      e.preventDefault();
      shell.openExternal(u);
    }
  });
  win.loadURL(url);
  win.on('closed', () => (win = null));
}

function buildMenu() {
  const template = [
    { label: app.name, submenu: [{ role: 'about', label: 'Sobre o IMPACTO HEADSOFTWARE' }, { type: 'separator' }, { role: 'hide', label: 'Ocultar' }, { role: 'quit', label: 'Sair' }] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
    { label: 'Ver', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
    { label: 'Janela', submenu: [{ role: 'minimize', label: 'Minimizar' }, { role: 'close', label: 'Fechar' }] },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Pasta de dados do app', click: () => shell.openPath(userData()) },
        { label: 'Site do Studio Impacto', click: () => shell.openExternal('https://studioimpacto.com.br') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName('IMPACTO HEADSOFTWARE');

app.whenReady().then(async () => {
  buildMenu();
  try {
    const url = await startServer();
    if (url) createWindow(url);
  } catch (e) {
    dialog.showErrorBox('IMPACTO HEADSOFTWARE', `Não foi possível iniciar: ${e.message}`);
    app.quit();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && server) createWindow(`http://127.0.0.1:${PORT}`);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (server) server.kill();
});
