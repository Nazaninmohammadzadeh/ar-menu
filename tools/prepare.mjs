#!/usr/bin/env node
/**
 * Taranmış bir yemek modelini AR menü için hazırlar.
 *
 *  - Gerçek boyuta ölçekler (ölçtüğün tabak çapı veya yükseklik)
 *  - Modeli ortalar ve tabanını zemine (y = 0) oturtur
 *  - Üçgen sayısını düşürür (meshoptimizer)
 *  - Dokuları küçültüp JPEG'e çevirir
 *  - Sonucu sıkıştırmasız, her telefonla uyumlu bir GLB olarak yazar
 *
 * Kullanım:
 *   npm run model -- <girdi.glb> --size 26 [--out models/yemek.glb]
 *
 * Seçenekler:
 *   --size <cm>       En geniş yatay ölçü (ör. tabak çapı), santimetre
 *   --height <cm>     Ya da yükseklik, santimetre (--size yerine)
 *   --tris <sayı>     Hedef üçgen sayısı (varsayılan 80000)
 *   --texture <px>    En büyük doku boyutu (varsayılan 2048)
 *   --rotx/--roty/--rotz <derece>  Yamuk/yan yatmış modeli döndürmek için
 *   --trim <mm>       Tabanda kalan masa parçasını kes (ör. 3)
 *   --out <dosya>     Çıktı yolu (varsayılan: models/<girdi-adı>.glb)
 */
import path from 'node:path';
import fs from 'node:fs';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, simplify, prune, textureCompress, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';

// ---------- argümanlar ----------
const args = process.argv.slice(2);
const input = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (!input || (!opt('size') && !opt('height'))) {
  console.log(`
Kullanım:  npm run model -- <girdi.glb> --size <cm> [--out models/yemek.glb]

  --size <cm>      En geniş yatay ölçü (tabak çapı gibi)
  --height <cm>    veya yükseklik
  --tris <sayı>    Hedef üçgen sayısı (varsayılan 80000)
  --texture <px>   Maksimum doku boyutu (varsayılan 2048)
  --rotx/--roty/--rotz <derece>  Modeli döndür (yan yatmışsa)
  --trim <mm>      Tabanda kalan masa parçasını kes (ör. 3)
`);
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`Dosya bulunamadı: ${input}`);
  process.exit(1);
}
const sizeCm = opt('size') ? parseFloat(opt('size')) : null;
const heightCm = opt('height') ? parseFloat(opt('height')) : null;
const targetTris = parseInt(opt('tris', '80000'), 10);
const maxTex = parseInt(opt('texture', '2048'), 10);
const rot = ['x', 'y', 'z'].map((a) => (parseFloat(opt(`rot${a}`, '0')) * Math.PI) / 180);
const out = opt('out', path.join('models', path.basename(input).replace(/\.[^.]+$/, '') + '.glb'));

// ---------- yardımcılar ----------
const countTris = (doc) => {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute('POSITION');
      n += idx ? idx.getCount() / 3 : pos ? pos.getCount() / 3 : 0;
    }
  }
  return Math.round(n);
};

// Euler (XYZ) -> quaternion
const eulerToQuat = ([x, y, z]) => {
  const [cx, sx] = [Math.cos(x / 2), Math.sin(x / 2)];
  const [cy, sy] = [Math.cos(y / 2), Math.sin(y / 2)];
  const [cz, sz] = [Math.cos(z / 2), Math.sin(z / 2)];
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
};

// ---------- işlem ----------
await MeshoptSimplifier.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'meshopt.decoder': MeshoptDecoder,
  });

const doc = await io.read(input);
const root = doc.getRoot();

// Girdi sıkıştırılmışsa çıktıyı sıkıştırmasız yaz (Android/iPhone uyumluluğu için en güvenlisi)
for (const ext of root.listExtensionsUsed()) {
  if (['KHR_draco_mesh_compression', 'EXT_meshopt_compression'].includes(ext.extensionName)) ext.dispose();
}

const trisBefore = countTris(doc);

// Tüm sahneyi tek bir kök düğümün altına al: ölçek/konum/dönüşü ona uygulayacağız
const scene = root.getDefaultScene() || root.listScenes()[0];
const wrapper = doc.createNode('yemek');
for (const child of scene.listChildren()) {
  scene.removeChild(child);
  wrapper.addChild(child);
}
scene.addChild(wrapper);
wrapper.setRotation(eulerToQuat(rot));

// --trim: tabanda kalan masa parçasını (alttaki ince şerit) kes
const trimMm = parseFloat(opt('trim', '0'));
if (trimMm > 0) {
  const b0 = getBounds(scene);
  const s0 = sizeCm
    ? sizeCm / 100 / Math.max(b0.max[0] - b0.min[0], b0.max[2] - b0.min[2])
    : heightCm / 100 / (b0.max[1] - b0.min[1]);
  const limit = b0.min[1] + trimMm / 1000 / s0;
  let removed = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const n = pos.getCount();
      const idx = prim.getIndices() ? Array.from(prim.getIndices().getArray()) : [...Array(n).keys()];
      const wy = new Float32Array(n);
      const p = [0, 0, 0];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, p);
        wy[i] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      }
      const keep = [];
      for (let t = 0; t < idx.length; t += 3) {
        const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
        if (wy[a] < limit && wy[b] < limit && wy[c] < limit) removed++;
        else keep.push(a, b, c);
      }
      const arr = n > 65535 ? new Uint32Array(keep) : new Uint16Array(keep);
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(pos.getBuffer()));
      compactPrimitive(prim);
    }
  }
  console.log(`  Tabandan ${trimMm} mm kesildi (${removed.toLocaleString('tr-TR')} üçgen)`);
}

// Üçgen sayısını düşür
await doc.transform(weld());
if (trisBefore > targetTris) {
  const ratio = targetTris / trisBefore;
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.002 }));
}

// Dokuları küçült ve JPEG'e çevir
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 85, resize: [maxTex, maxTex] }),
  dedup(),
  prune(),
);

// Gerçek boyuta ölçekle, ortala, zemine oturt
const b = getBounds(scene);
const w = b.max[0] - b.min[0];
const h = b.max[1] - b.min[1];
const d = b.max[2] - b.min[2];
const s = sizeCm ? sizeCm / 100 / Math.max(w, d) : heightCm / 100 / h;
const cx = (b.min[0] + b.max[0]) / 2;
const cz = (b.min[2] + b.max[2]) / 2;
wrapper.setScale([s, s, s]);
wrapper.setTranslation([-cx * s, -b.min[1] * s, -cz * s]);

doc.getRoot().getAsset().generator = 'ar-menu prepare.mjs (glTF-Transform)';
fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);

// ---------- rapor ----------
const trisAfter = countTris(doc);
const mb = fs.statSync(out).size / 1024 / 1024;
const cm = (v) => (v * s * 100).toFixed(1);
console.log(`
✔ Hazır: ${out}
  Boyut (G × D × Y): ${cm(w)} × ${cm(d)} × ${cm(h)} cm
  Üçgen: ${trisBefore.toLocaleString('tr-TR')} → ${trisAfter.toLocaleString('tr-TR')}
  Dosya: ${mb.toFixed(2)} MB${mb > 5 ? '  ⚠ 5 MB üstü: --tris veya --texture değerini düşür' : ''}

Kontrol: Ölçüler gerçeğe uyuyor mu? Model yan yatmışsa --rotx 90 (veya -90) ile tekrar çalıştır.
Sıradaki adım (iPhone için):  npm run usdz -- ${out}
`);
