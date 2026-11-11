# AR Menü – başlangıç kiti

Restoran menüsündeki yemekleri müşterinin telefonunda 3D olarak gösteren ve
"Masanda gör" butonuyla gerçek boyutta masaya koyan (AR) statik bir web sitesi.
Uygulama indirmek gerekmez: masadaki QR okutulur, tarayıcıda açılır.

- Android → Google Scene Viewer / WebXR (`.glb`)
- iPhone → Apple AR Quick Look (`.usdz`)

## Hızlı başlangıç

```bash
npm install                          # araçlar için bir kez
pip install -r tools/requirements.txt  # iPhone (USDZ) dönüştürücüsü için bir kez
npm run serve                        # http://localhost:8080
```

## Yeni bir yemek eklemek

```bash
# 1) Taramayı hazırla: gerçek boyut (cm), ortala, zemine oturt, küçült
npm run model -- taramalar/lahmacun.glb --size 30 --out models/lahmacun.glb

#    Tabanda masa şeridi kaldıysa --trim 3 ekle; dik duran paketlerde --height kullan:
npm run model -- taramalar/dankek/model.glb --height 17.8 --trim 2.5 --out models/dankek.glb

#    iPhone'dan OBJ geldiyse önce GLB'ye çevir:
npm run obj2glb -- -i taramalar/lahmacun/model.obj -o taramalar/lahmacun.glb

# 2) iPhone için USDZ üret
npm run usdz -- models/lahmacun.glb

# 3) menu.json'a yemeği ekle ("model" ve "modelIos" alanları)
# 4) Kapak görseli: npm run serve → http://localhost:8080/tools/poster.html
```

## Yayınlama ve QR

GitHub Pages'e yükle (AR için HTTPS şart), sonra:

```bash
npm run qr -- --url https://KULLANICI.github.io/ar-menu/ --tables 12
# qr/yazdir.html dosyasını açıp yazdır
```

## Dosyalar

| Dosya | Ne işe yarar |
|---|---|
| `menu.json` | Restoran adı, kategoriler, yemekler (TR/EN, fiyat, içerik, alerjen, kalori, model) |
| `index.html`, `app.js`, `style.css` | Menü sitesi |
| `models/` | `.glb` (Android/web) ve `.usdz` (iPhone) modeller |
| `img/` | Kapak görselleri |
| `vendor/model-viewer.min.js` | Google model-viewer 4.x (yerel kopya) |
| `tools/prepare.mjs` | Tarama hazırlama (`npm run model`) |
| `tools/glb2usdz.py` | GLB → USDZ (`npm run usdz`) |
| `tools/qr.mjs` | Masa QR kodları (`npm run qr`) |
| `tools/poster.html` | 3D modelden kapak görseli |
| `tools/serve.mjs` | Yerel sunucu (`npm run serve`) |

Alerjen anahtarları (`allergens`): `gluten`, `kabuklu_deniz`, `yumurta`, `balik`, `yer_fistigi`,
`soya`, `sut`, `kabuklu_yemis`, `kereviz`, `hardal`, `susam`, `sulfit`, `aci_bakla`, `yumusakca`.

Örnek burger modeli test amaçlı, basit geometriyle üretildi. Gerçek yemekler için RealityScan ile tarama yap.
