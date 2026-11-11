#!/usr/bin/env node
/**
 * Her masa için QR kod ve yazdırılabilir bir sayfa üretir.
 *
 * Kullanım:
 *   npm run qr -- --url https://KULLANICI.github.io/ar-menu/ --tables 12 [--name "Restoran Adı"]
 *
 * Çıktı:
 *   qr/masa-01.png ... qr/masa-12.png
 *   qr/yazdir.html  (tarayıcıda aç, Ctrl+P ile yazdır)
 */
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const base = opt('url');
const tables = parseInt(opt('tables', '10'), 10);
let name = opt('name');
if (!base) {
  console.log('Kullanım: npm run qr -- --url https://KULLANICI.github.io/ar-menu/ --tables 12 [--name "Restoran"]');
  process.exit(1);
}
if (!name) {
  try {
    name = JSON.parse(fs.readFileSync('menu.json', 'utf8')).restaurant.name;
  } catch {
    name = 'Menü';
  }
}

const outDir = 'qr';
fs.mkdirSync(outDir, { recursive: true });
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cards = [];

for (let t = 1; t <= tables; t++) {
  const url = new URL(base);
  url.searchParams.set('masa', String(t));
  const opts = { errorCorrectionLevel: 'M', margin: 2, width: 800 };
  await QRCode.toFile(path.join(outDir, `masa-${pad(t)}.png`), url.toString(), opts);
  const dataUrl = await QRCode.toDataURL(url.toString(), { ...opts, width: 400 });
  cards.push(`
    <div class="card">
      <div class="name">${esc(name)}</div>
      <img src="${dataUrl}" alt="QR masa ${t}">
      <div class="cta">Menü ve 3D yemekler için okutun<br><span>Scan for the menu &amp; 3D dishes</span></div>
      <div class="table">Masa ${t}</div>
    </div>`);
}

fs.writeFileSync(
  path.join(outDir, 'yazdir.html'),
  `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(name)} – QR kodlar</title>
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: system-ui, sans-serif; margin: 0; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; }
  .card { border: 1px dashed #bbb; border-radius: 4mm; padding: 6mm; text-align: center; break-inside: avoid; }
  .name { font-weight: 700; font-size: 16pt; }
  img { width: 55mm; height: 55mm; margin: 3mm 0; }
  .cta { font-size: 10pt; } .cta span { color: #666; }
  .table { margin-top: 3mm; font-weight: 700; font-size: 14pt; }
</style></head><body><div class="grid">${cards.join('')}</div></body></html>`,
);

console.log(`✔ ${tables} masa için QR üretildi → ${outDir}/ (yazdırmak için ${outDir}/yazdir.html dosyasını aç)`);
console.log(`  Örnek adres: ${new URL('?masa=1', base)}`);
