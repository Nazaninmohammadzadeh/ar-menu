// AR Menü — menu.json'u okur, menüyü çizer, yemek detayında 3D/AR gösterir.

const UI = {
  tr: {
    loading: 'Menü yükleniyor…',
    error: 'Menü yüklenemedi. menu.json dosyasını kontrol edin.',
    table: 'Masa',
    ar: 'Masanda gör',
    arHint: 'Yemeği masanda görmek için bu sayfayı telefonunla aç.',
    arTip: 'İpucu: "Masanda gör"e basmadan önce telefonu masaya doğrult.',
    arFailed: 'Bu cihazda AR açılamadı. 3D görünümü kullanabilirsin.',
    badge3d: '3D · AR',
    ingredients: 'İçindekiler',
    allergens: 'Alerjenler',
    calories: 'Enerji',
    none: 'Yok',
    kcal: 'kcal',
    close: 'Kapat',
    other: 'Diğer',
  },
  en: {
    loading: 'Loading menu…',
    error: 'Could not load the menu.',
    table: 'Table',
    ar: 'See it on your table',
    arHint: 'Open this page on your phone to see the dish on your table.',
    arTip: 'Tip: point your phone at the table before tapping the button.',
    arFailed: "AR isn't available on this device. You can still use the 3D view.",
    badge3d: '3D · AR',
    ingredients: 'Ingredients',
    allergens: 'Allergens',
    calories: 'Energy',
    none: 'None',
    kcal: 'kcal',
    close: 'Close',
    other: 'Other',
  },
};

// Türk Gıda Kodeksi'ndeki 14 alerjen grubu
const ALLERGENS = {
  gluten: { tr: 'Gluten', en: 'Gluten' },
  kabuklu_deniz: { tr: 'Kabuklu deniz ürünleri', en: 'Crustaceans' },
  yumurta: { tr: 'Yumurta', en: 'Egg' },
  balik: { tr: 'Balık', en: 'Fish' },
  yer_fistigi: { tr: 'Yer fıstığı', en: 'Peanut' },
  soya: { tr: 'Soya', en: 'Soy' },
  sut: { tr: 'Süt', en: 'Milk' },
  kabuklu_yemis: { tr: 'Sert kabuklu meyveler', en: 'Tree nuts' },
  kereviz: { tr: 'Kereviz', en: 'Celery' },
  hardal: { tr: 'Hardal', en: 'Mustard' },
  susam: { tr: 'Susam', en: 'Sesame' },
  sulfit: { tr: 'Sülfit', en: 'Sulphites' },
  aci_bakla: { tr: 'Acı bakla (lupin)', en: 'Lupin' },
  yumusakca: { tr: 'Yumuşakçalar', en: 'Molluscs' },
};

const $ = (sel, el = document) => el.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* gizli mod vb. */ } },
};

let menu = null;
let lang = 'tr';

// Çok dilli alan: "metin" veya { tr: "...", en: "..." }
const t = (v) => (v == null ? '' : typeof v === 'string' ? v : v[lang] ?? v.tr ?? Object.values(v)[0] ?? '');
const ui = (k) => UI[lang]?.[k] ?? UI.tr[k];

function formatPrice(p) {
  if (p == null || p === '') return '';
  const n = Number(p);
  const s = Number.isFinite(n) ? n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB', { maximumFractionDigits: 2 }) : String(p);
  return `${s} ${menu.restaurant.currency ?? '₺'}`;
}

function pickLanguage() {
  const saved = store.get('lang');
  if (saved && UI[saved]) return saved;
  const nav = (navigator.language || 'tr').slice(0, 2);
  return UI[nav] ? nav : menu.restaurant.defaultLanguage || 'tr';
}

// ---------- Menü listesi ----------
function renderMenu() {
  document.documentElement.lang = lang;
  document.title = menu.restaurant.name;
  $('#restaurant-name').textContent = menu.restaurant.name;
  $('#lang-toggle').textContent = lang === 'tr' ? 'EN' : 'TR';

  const table = new URLSearchParams(location.search).get('masa');
  const badge = $('#table-badge');
  badge.hidden = !table;
  if (table) badge.textContent = `${ui('table')} ${table}`;

  const nav = $('#category-nav');
  const main = $('#menu');
  nav.replaceChildren();
  main.replaceChildren();

  const cats = [...(menu.categories || [])];
  const known = new Set(cats.map((c) => c.id));
  if (menu.items.some((i) => !known.has(i.category))) cats.push({ id: '_diger', name: { tr: UI.tr.other, en: UI.en.other } });

  for (const cat of cats) {
    const items = menu.items.filter((i) => (known.has(i.category) ? i.category === cat.id : cat.id === '_diger'));
    if (!items.length) continue;

    const chip = el('a', 'chip', t(cat.name));
    chip.href = `#kategori-${cat.id}`;
    nav.append(chip);

    const section = el('section', 'category');
    section.id = `kategori-${cat.id}`;
    section.append(el('h2', 'category-title', t(cat.name)));
    for (const item of items) section.append(renderCard(item));
    main.append(section);
  }

  $('#footer').textContent = t(menu.restaurant.footer);
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = ui(n.dataset.i18n); });
}

function renderCard(item) {
  const card = el('button', 'card');
  card.type = 'button';
  card.addEventListener('click', () => openItem(item));

  const thumb = el('div', 'thumb');
  if (item.image) {
    const img = el('img');
    img.src = item.image;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => { img.remove(); thumb.classList.add('empty'); thumb.textContent = t(item.name).charAt(0); };
    thumb.append(img);
  } else {
    thumb.classList.add('empty');
    thumb.textContent = t(item.name).charAt(0);
  }
  if (item.model) thumb.append(el('span', 'badge-3d', ui('badge3d')));

  const body = el('div', 'card-body');
  body.append(el('h3', 'card-title', t(item.name)));
  if (item.description) body.append(el('p', 'card-desc', t(item.description)));
  body.append(el('div', 'price', formatPrice(item.price)));

  card.append(thumb, body);
  return card;
}

// ---------- Detay ekranı ----------
const sheet = $('#sheet');

function openItem(item) {
  $('#sheet-title').textContent = t(item.name);
  $('#sheet-price').textContent = formatPrice(item.price);
  $('#sheet-desc').textContent = t(item.description);
  const size = $('#sheet-size');
  size.hidden = !item.size;
  size.textContent = t(item.size);

  const ing = $('#fact-ingredients');
  ing.hidden = !item.ingredients;
  $('dd', ing).textContent = t(item.ingredients);

  const alg = $('#fact-allergens');
  const list = item.allergens || [];
  alg.hidden = !Array.isArray(item.allergens);
  $('dd', alg).replaceChildren(
    ...(list.length ? list.map((a) => el('span', 'allergen', ALLERGENS[a]?.[lang] ?? a)) : [el('span', null, ui('none'))]),
  );

  const cal = $('#fact-calories');
  cal.hidden = item.calories == null;
  $('dd', cal).textContent = `${item.calories} ${ui('kcal')}`;

  const media = $('#sheet-media');
  media.replaceChildren();
  if (item.model) {
    media.append(buildViewer(item));
  } else if (item.image) {
    const img = el('img', 'sheet-img');
    img.src = item.image;
    img.alt = t(item.name);
    media.append(img);
  } else {
    media.append(el('div', 'sheet-placeholder', t(item.name).charAt(0)));
  }

  $('.sheet-close').setAttribute('aria-label', ui('close'));
  if (!sheet.open) sheet.showModal();
  if (location.hash !== `#${item.id}`) history.replaceState(null, '', `${location.pathname}${location.search}#${item.id}`);
}

function buildViewer(item) {
  const frag = $('#tpl-viewer').content.cloneNode(true);
  const mv = $('model-viewer', frag);
  mv.src = item.model;
  if (item.modelIos) mv.setAttribute('ios-src', item.modelIos);
  if (item.image) mv.poster = item.image;
  mv.alt = t(item.name);
  const arBtn = $('.ar-button', mv);
  arBtn.textContent = ui('ar');

  const wrap = el('div', 'viewer-wrap');
  const hint = el('p', 'ar-hint');
  hint.hidden = true;
  wrap.append(mv, hint);

  // Yükleme çubuğu
  const fill = $('.progress-fill', mv);
  mv.addEventListener('progress', (e) => {
    const p = e.detail.totalProgress;
    fill.style.width = `${Math.round(p * 100)}%`;
    fill.parentElement.classList.toggle('done', p >= 1);
  });

  // AR yoksa (masaüstü vb.) bilgi göster
  mv.addEventListener('load', () => {
    hint.textContent = ui(mv.canActivateAR ? 'arTip' : 'arHint');
    hint.hidden = false;
  });
  mv.addEventListener('ar-status', (e) => {
    if (e.detail.status === 'failed') {
      hint.textContent = ui('arFailed');
      hint.hidden = false;
    }
  });
  return wrap;
}

function closeSheet() {
  sheet.close();
}

sheet.addEventListener('close', () => {
  $('#sheet-media').replaceChildren(); // modeli bellekten at
  history.replaceState(null, '', `${location.pathname}${location.search}`);
});
sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-close]')) closeSheet();
});

$('#lang-toggle').addEventListener('click', () => {
  lang = lang === 'tr' ? 'en' : 'tr';
  store.set('lang', lang);
  renderMenu();
});

// ---------- Başlat ----------
async function init() {
  try {
    const res = await fetch('menu.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    menu = await res.json();
  } catch (err) {
    console.error(err);
    $('#menu').replaceChildren(el('p', 'loading', UI.tr.error));
    return;
  }
  lang = pickLanguage();
  renderMenu();

  openFromHash();
  window.addEventListener('hashchange', openFromHash);
}

// Paylaşılabilir bağlantı: .../#klasik-burger o yemeği doğrudan açar
function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const item = id && menu.items.find((i) => i.id === id);
  if (item) openItem(item);
}

init();