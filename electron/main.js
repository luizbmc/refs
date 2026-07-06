const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: 'Refs',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
}

function requestUrl(url, method) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({ url, ok: false, status: null, finalUrl: url, erro: 'URL inválida' });
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(parsed, {
      method,
      timeout: 10000,
      headers: {
        'User-Agent': 'Refs/0.1 URL Checker'
      }
    }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      res.resume();
      resolve({
        url,
        ok: status >= 200 && status < 400,
        status,
        finalUrl: location ? new URL(location, parsed).toString() : url,
        redirecionado: !!location
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout'));
    });
    req.on('error', (err) => {
      resolve({ url, ok: false, status: null, finalUrl: url, erro: err.message || String(err) });
    });
    req.end();
  });
}

async function validarUrl(url) {
  const head = await requestUrl(url, 'HEAD');
  if (head.ok || head.status === 404) return head;
  return requestUrl(url, 'GET');
}

ipcMain.handle('refs:validarUrls', async (event, urls) => {
  const lista = Array.isArray(urls) ? urls : [];
  const resultados = [];
  for (let i = 0; i < lista.length; i += 1) {
    resultados.push(await validarUrl(lista[i]));
  }
  return resultados;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
