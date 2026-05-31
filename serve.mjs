// Study Support 用の極小・静的ファイルサーバー（dist を配信）。
// vite preview と違い stdin を一切読まないため、ウィンドウ非表示で起動しても
// EOF で終了せず常駐できる。SPA はハッシュルーティングなので index.html 返却で足りる。
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = 'C:\\Projects\\study-suport\\dist';
const PORT = 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    let fp = normalize(join(ROOT, p));
    // ディレクトリトラバーサル防止
    if (!fp.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    let data;
    try {
      const s = await stat(fp);
      if (s.isDirectory()) fp = join(fp, 'index.html');
      data = await readFile(fp);
    } catch {
      // 見つからないパスは index.html を返す（SPA フォールバック）
      fp = join(ROOT, 'index.html');
      data = await readFile(fp);
    }
    res.writeHead(200, { 'content-type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Study Support running at http://localhost:' + PORT);
});
