#!/usr/bin/env node
/**
 * Bağımlılıksız küçük bir yerel sunucu: siteyi bilgisayarında ve
 * aynı Wi-Fi'deki telefonunda açmak için.
 *
 *   npm run serve            (varsayılan port 8080)
 *
 * Not: AR (kamerada görme) için site HTTPS üzerinden yayında olmalı
 * (ör. GitHub Pages). Yerelde menüyü ve 3D görüntüyü test edebilirsin.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const port = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
const root = process.cwd();
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.usdz': 'model/vnd.usdz+zip', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root) || file.includes(`${path.sep}node_modules${path.sep}`)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Bulunamadı');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`\nMenü çalışıyor:\n  Bu bilgisayarda:  http://localhost:${port}/`);
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) console.log(`  Telefonda (aynı Wi-Fi):  http://${n.address}:${port}/`);
    }
  }
  console.log('\nDurdurmak için Ctrl+C\n');
});
