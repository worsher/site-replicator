import http from 'node:http';
import { PNG } from 'pngjs';

// 生成一个纯色 PNG buffer（用于充当 logo.png 等图片资源）
export function makePng(width = 8, height = 8, rgba = [255, 0, 0, 255]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    png.data[o] = rgba[0];
    png.data[o + 1] = rgba[1];
    png.data[o + 2] = rgba[2];
    png.data[o + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Fixture</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<h1 id="title">Hello</h1>
<div class="box"><img src="/logo.png" alt="logo"></div>
</body></html>`;

const STYLE_CSS = `#title { color: rgb(10, 20, 30); font-size: 32px; }
.box { width: 100px; height: 100px; background: rgb(200, 200, 200); }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.box img { animation: spin 2s linear infinite; }
.u-bg-q { background-image: url("/logo.png"); }
.u-bg-u { background-image: url(/logo.png); }`;

// 启动一个服务于固定 fixture 站点的服务器；返回 { url, close, requests }
export function startFixtureServer() {
  const requests = [];
  const png = makePng();
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(INDEX_HTML);
    } else if (req.url === '/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(STYLE_CSS);
    } else if (req.url === '/logo.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); },
      });
    });
  });
}
