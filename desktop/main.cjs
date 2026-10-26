// Impacto · app desktop (macOS e Windows 10+)
// Sobe o servidor Next (standalone) dentro do app, abre a janela (vidro nativo no macOS, barra escura no Windows)
// e oferece ao servidor um serviço local de PDF (Chromium do próprio Electron) para o brandbook.
const { app, BrowserWindow, shell, nativeTheme, Menu, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');

const APP_NAME = 'Impacto';
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const PORT = Number(process.env.IHS_PORT || 3741);
const DEV_URL = process.env.IHS_DEV_URL || '';
let server = null;
let win = null;
let pdfService = null;

const userData = () => app.getPath('userData');

/** Lê variáveis do arquivo .env na pasta de dados do app (gravado pelo instalador) ou do .env.local do projeto. */
function loadEnv() {
  // Ordem: ajustes da máquina (userData/.env) > projeto (.env.local) > runtime.env embutido no pacote do time
  const candidates = [
    path.join(userData(), '.env'),
    path.join(app.getPath('appData'), 'IMPACTO HEADSOFTWARE', '.env'), // instalações anteriores ao nome "Impacto"
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env'),
    path.join(process.resourcesPath || '', 'app', 'runtime.env'),
  ];
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

/** Serviço de PDF: o servidor interno manda um HTML (arquivo temporário) e recebe o PDF impresso pelo Chromium do app. */
function startPdfService() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/pdf') {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let hidden = null;
        try {
          const { file, width = 1600, height = 1000 } = JSON.parse(body || '{}');
          if (!file || !fs.existsSync(file)) throw new Error('arquivo não encontrado');
          hidden = new BrowserWindow({ show: false, width, height, webPreferences: { offscreen: false, contextIsolation: true, nodeIntegration: false } });
          await hidden.loadFile(file);
          await hidden.webContents.executeJavaScript('(document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(() => new Promise(r => setTimeout(r, 400)))', true);
          const pdf = await hidden.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: { width: width / 96, height: height / 96 }, margins: { marginType: 'none' } });
          res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length }).end(pdf);
        } catch (e) {
          res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e && e.message ? e.message : e));
        } finally {
          if (hidden && !hidden.isDestroyed()) hidden.destroy();
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      pdfService = srv;
      resolve(`http://127.0.0.1:${srv.address().port}`);
    });
    srv.on('error', () => resolve(''));
  });
}

async function startServer() {
  if (DEV_URL) return DEV_URL;
  const base = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..', '.next', 'standalone');
  const serverJs = path.join(base, 'server.js');
  if (!fs.existsSync(serverJs)) {
    dialog.showErrorBox(APP_NAME, 'Build do app não encontrado. Rode "npm run build" na pasta do projeto ou use o instalador.');
    app.quit();
    return null;
  }
  const dataDir = path.join(userData(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const pdfUrl = await startPdfService();
  const env = {
    ...process.env,
    ...loadEnv(),
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOSTNAME: '127.0.0.1',
    IHS_DATA_DIR: dataDir,
    IHS_DESKTOP: '1',
    ...(pdfUrl ? { IHS_PDF_SERVICE: pdfUrl } : {}),
  };
  server = spawn(process.execPath, [serverJs], { env, cwd: base, stdio: 'inherit', windowsHide: true });
  server.on('exit', (code) => {
    server = null;
    if (code && win) dialog.showErrorBox(APP_NAME, `O servidor interno parou (código ${code}).`);
  });
  await waitFor(`http://127.0.0.1:${PORT}/api/health`);
  return `http://127.0.0.1:${PORT}`;
}

const webPreferences = () => ({ preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, spellcheck: true });

function wireLinks(w, url) {
  w.webContents.setWindowOpenHandler(({ url: u }) => {
    // Links internos abertos "em nova aba" (brandbook, arquivos) viram uma nova janela do app; externos vão para o navegador.
    if (u.startsWith(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 900, title: APP_NAME, backgroundColor: '#0A0A0A', webPreferences: webPreferences() } };
    if (u.startsWith('http')) shell.openExternal(u);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, u) => {
    if (!u.startsWith(url)) {
      e.preventDefault();
      shell.openExternal(u);
    }
  });
  w.webContents.on('did-create-window', (child) => wireLinks(child, url));
}

function createWindow(url) {
  const platformWindow = IS_MAC
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 }, vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
    : { backgroundColor: '#0A0A0A', autoHideMenuBar: true };
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    transparent: false,
    ...platformWindow,
    webPreferences: webPreferences(),
  });
  if (IS_WIN) win.maximize();
  nativeTheme.themeSource = 'dark';
  win.once('ready-to-show', () => win.show());
  wireLinks(win, url);
  win.loadURL(url);
  win.on('closed', () => (win = null));
}

function buildMenu() {
  if (IS_WIN) {
    // No Windows o menu fica escondido (Alt mostra); mantém só os atalhos úteis.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'Arquivo', submenu: [{ label: 'Pasta de dados do app', click: () => shell.openPath(userData()) }, { type: 'separator' }, { role: 'quit', label: 'Sair' }] },
        { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
        { label: 'Ver', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'toggleDevTools', label: 'Ferramentas de desenvolvedor' }, { type: 'separator' }, { role: 'resetZoom', label: 'Tamanho real' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
        { label: 'Ajuda', submenu: [{ label: 'Site do Studio Impacto', click: () => shell.openExternal('https://studioimpacto.com.br') }] },
      ]),
    );
    return;
  }
  const template = [
    { label: app.name, submenu: [{ role: 'about', label: `Sobre o ${APP_NAME}` }, { type: 'separator' }, { role: 'hide', label: 'Ocultar' }, { role: 'quit', label: 'Sair' }] },
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

app.setName(APP_NAME);
if (IS_WIN) app.setAppUserModelId('br.com.studioimpacto.impacto');

// Uma janela só: abrir o atalho de novo traz o app para a frente em vez de subir outro servidor.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  buildMenu();
  try {
    const url = await startServer();
    if (url) createWindow(url);
  } catch (e) {
    dialog.showErrorBox(APP_NAME, `Não foi possível iniciar: ${e.message}`);
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
  if (pdfService) pdfService.close();
});
