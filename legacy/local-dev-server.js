const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8888);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function loadEnvFile(filename) {
  const fullPath = path.join(ROOT, filename);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, statusCode, body, headers) {
  res.writeHead(statusCode, headers || {});
  res.end(body);
}

function getStaticFilePath(urlPath) {
  const relativePath = urlPath === '/' ? '/index.html' : urlPath;
  const fullPath = path.join(ROOT, relativePath.replace(/^\/+/, ''));
  const resolved = path.resolve(fullPath);

  if (!resolved.startsWith(path.resolve(ROOT))) {
    return null;
  }

  return resolved;
}

async function handleFunction(req, res, pathname, searchParams) {
  const functionName = pathname.replace('/.netlify/functions/', '').replace(/\/+$/, '');
  const functionPath = path.join(ROOT, 'netlify', 'functions', functionName + '.js');

  if (!fs.existsSync(functionPath)) {
    send(res, 404, JSON.stringify({ error: 'Function not found' }), { 'Content-Type': 'application/json; charset=utf-8' });
    return;
  }

  const body = await readRequestBody(req);
  delete require.cache[require.resolve(functionPath)];
  const mod = require(functionPath);

  const event = {
    httpMethod: req.method,
    headers: req.headers,
    body,
    rawUrl: req.url,
    path: pathname,
    queryStringParameters: Object.fromEntries(searchParams.entries())
  };

  const result = await mod.handler(event, {});
  send(res, result.statusCode || 200, result.body || '', result.headers || { 'Content-Type': 'text/plain; charset=utf-8' });
}

async function requestListener(req, res) {
  try {
    const currentUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const pathname = decodeURIComponent(currentUrl.pathname);

    if (pathname.startsWith('/.netlify/functions/')) {
      await handleFunction(req, res, pathname, currentUrl.searchParams);
      return;
    }

    const filePath = getStaticFilePath(pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    send(res, 200, fs.readFileSync(filePath), { 'Content-Type': contentType });
  } catch (error) {
    send(res, 500, String(error && error.stack ? error.stack : error), { 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

loadEnvFile('.env');
loadEnvFile('.env.local');

http.createServer((req, res) => {
  Promise.resolve(requestListener(req, res)).catch((error) => {
    send(res, 500, String(error && error.stack ? error.stack : error), { 'Content-Type': 'text/plain; charset=utf-8' });
  });
}).listen(PORT, () => {
  console.log(`Local dev server running on http://127.0.0.1:${PORT}`);
});
