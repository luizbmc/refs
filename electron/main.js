const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');

const URL_CHECK_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Refs/0.1 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
};

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

function requestUrl(url, method, redirects, originalUrl, wasRedirected) {
  return new Promise((resolve) => {
    const requestedUrl = originalUrl || url;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({ url: requestedUrl, ok: false, status: null, finalUrl: url, erro: 'URL inválida' });
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(parsed, {
      method,
      timeout: 10000,
      headers: URL_CHECK_HEADERS
    }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      const finalUrl = location ? new URL(location, parsed).toString() : url;
      res.resume();
      if (location && status >= 300 && status < 400 && redirects < 5) {
        resolve(requestUrl(finalUrl, method, redirects + 1, requestedUrl, true));
        return;
      }
      resolve({
        url: requestedUrl,
        ok: status >= 200 && status < 400,
        status,
        finalUrl,
        redirecionado: !!location || !!wasRedirected
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Timeout'));
    });
    req.on('error', (err) => {
      resolve({ url: requestedUrl, ok: false, status: null, finalUrl: url, erro: err.message || String(err) });
    });
    req.end();
  });
}

async function requestUrlElectron(url, method) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return { url, ok: false, status: null, finalUrl: url, erro: 'URL inválida' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await net.fetch(parsed.toString(), {
      method,
      redirect: 'follow',
      headers: URL_CHECK_HEADERS,
      signal: controller.signal
    });
    if (response.body) {
      await response.body.cancel().catch(() => {});
    }
    const finalUrl = response.url || parsed.toString();
    return {
      url,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      finalUrl,
      redirecionado: finalUrl !== parsed.toString()
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: null,
      finalUrl: parsed.toString(),
      erro: err?.name === 'AbortError' ? 'Timeout' : (err.message || String(err))
    };
  } finally {
    clearTimeout(timer);
  }
}

async function validarUrl(url) {
  const head = await requestUrlElectron(url, 'HEAD');
  if (head.ok || head.status === 404) return head;

  const get = await requestUrlElectron(url, 'GET');
  if (get.ok || get.status) return get;

  const fallbackHead = await requestUrl(url, 'HEAD', 0);
  if (fallbackHead.ok || fallbackHead.status === 404) return fallbackHead;
  return requestUrl(url, 'GET', 0);
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
