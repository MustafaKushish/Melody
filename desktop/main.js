// Melody für Windows (und macOS/Linux): ein Fenster mit der Melody-App.
// Die App wird über einen kleinen lokalen Webserver geladen (nur 127.0.0.1), damit Musik spulen,
// Mikrofon (Song erkennen), Offline-Speicher und Module genauso funktionieren wie im Browser.
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'app');
// A fixed port keeps the same origin, so the library, playlists and settings survive restarts.
const PORTS = [38427, 38428, 38429];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.lrc': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function serve(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Nicht gefunden'); return; }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      start = Math.max(0, start); end = Math.min(end, st.size - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function listen(server, ports) {
  return new Promise((resolve, reject) => {
    const tryNext = (i) => {
      if (i >= ports.length) return reject(new Error('Kein freier Port'));
      server.once('error', () => tryNext(i + 1));
      server.listen(ports[i], '127.0.0.1', () => resolve(ports[i]));
    };
    tryNext(0);
  });
}

let win = null;

async function createWindow() {
  const server = http.createServer(serve);
  const port = await listen(server, PORTS);
  const origin = `http://127.0.0.1:${port}`;

  // Microphone (Song erkennen, Mitsingen), notifications and media keys only for Melody itself.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = (details.requestingUrl || '').startsWith(origin);
    cb(ok && ['media', 'notifications', 'mediaKeySystem', 'fullscreen', 'clipboard-sanitized-write', 'geolocation'].includes(permission));
  });

  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 380, minHeight: 560,
    title: 'Melody', backgroundColor: '#0f0f14', show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'app', 'icons', 'icon-512.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());

  // Links to other websites (Stripe, Impressum, Podcasts …) open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); }
  });
  // F11 full screen, Ctrl+R reload, F12 developer tools – there is no menu bar.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
    else if ((input.control || input.meta) && input.key.toLowerCase() === 'r') { win.webContents.reload(); e.preventDefault(); }
  });

  win.loadURL(`${origin}/index.html`);
  win.on('closed', () => { win = null; server.close(); });
}

// Only one Melody at a time: a second start brings the open window to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.setAppUserModelId('app.melody.desktop');
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
