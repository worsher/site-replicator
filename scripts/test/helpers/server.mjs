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

// 懒加载页：占位 data: URI + data-lazy-src 真图（模拟 lazysizes/LiteSpeed 输出）
const LAZY_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lazy</title></head>
<body>
<h1 id="title">Lazy</h1>
<img id="lz" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-lazy-src="/logo2.png" data-lazyloaded="1">
</body></html>`;

// 二级页：站内互链 + 商业链接（供多页批量管线测试）
const ABOUT_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>About</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<h1 id="title">About</h1>
<a id="home-link" href="/">home</a>
<a id="cart-link" href="/cart/">cart</a>
<img src="/logo.png" alt="logo">
</body></html>`;

const APP_JS = `console.log('app');`;

// 大尺寸 CSS 无限旋转：不冻结动画时，两次抓取的旋转角必然不同（截图确定性测试用）
const MOTION_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Motion</title>
<style>#sp{width:200px;height:200px;background:red;margin:24px;animation:sp 3s linear infinite}@keyframes sp{from{transform:rotate(0)}to{transform:rotate(360deg)}}</style>
</head><body><div id="sp"></div></body></html>`;

const STYLE_CSS = `#title { color: rgb(10, 20, 30); font-size: 32px; }
.box { width: 100px; height: 100px; background: rgb(200, 200, 200); }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.box img { animation: spin 2s linear infinite; }
.u-bg-q { background-image: url("/logo.png"); }
.u-bg-u { background-image: url(/logo.png); }`;

// 启动一个服务于固定 fixture 站点的服务器；返回 { url, close, requests }
// opts.logoColor 可自定义 logo.png 颜色（用于跨 host 冲突测试区分内容）
export function startFixtureServer(opts = {}) {
  const requests = [];
  const png = makePng(8, 8, opts.logoColor || [255, 0, 0, 255]);
  const png2 = makePng(8, 8, [0, 0, 255, 255]);
  const woff2 = Buffer.from('wOF2-fake-font-bytes');
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(INDEX_HTML);
    } else if (req.url === '/lazy.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(LAZY_HTML);
    } else if (req.url === '/motion.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(MOTION_HTML);
    } else if (req.url === '/about/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(ABOUT_HTML);
    } else if (req.url === '/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(STYLE_CSS);
    } else if (req.url === '/logo.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    } else if (req.url === '/logo2.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png2);
    } else if (req.url === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(APP_JS);
    } else if (req.url === '/font.woff2') {
      res.writeHead(200, { 'content-type': 'font/woff2' });
      res.end(woff2);
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
