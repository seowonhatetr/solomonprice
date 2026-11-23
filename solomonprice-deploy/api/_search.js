const ACC = /\b(case|cover|protector|tempered|screen guard|charger|cable|spare|replacement|combo|sticker|dummy|decals?|wraps?|holder|stand|mount|strap|lanyard|adapter|tripod|bumper|pouch|sleeve|housing|back panel|sim tray|ear ?tips?|ear ?hooks?|ear ?pads?|ear ?cushions?|keychain|key chain|hook|clip|carabiner|shell|silicone|guard|film|wallet|cushion)\b/i;
const REFURB = /\b(refurbished|renewed|certified|open box|reconditioned)\b/i, USED = /\b(used|pre-?owned|second ?hand|like new)\b/i;
const norm = q => String(q || '').toLowerCase().replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const compact = s => String(s || '').toLowerCase().replace(/[^a-z0-9+]/g, '');
function cond(i) {
  const sh = String(i.second_hand_condition || '').toLowerCase(), t = String(i.title || '');
  if (sh) return /refurb|renew/.test(sh) ? 'Refurbished' : 'Used';
  if (REFURB.test(t)) return 'Refurbished'; if (USED.test(t)) return 'Used'; return 'New';
}
async function fetchShopping(q) {
  const u = new URL('https://serpapi.com/search.json');
  Object.entries({ engine: 'google_shopping', q, gl: 'in', hl: 'en', google_domain: 'google.co.in', api_key: process.env.SERPAPI_KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('serpapi ' + r.status);
  return (await r.json()).shopping_results || [];
}
const GOOGLE = /(^|\.)(google\.[a-z.]+|googleadservices\.com|gstatic\.com|googleusercontent\.com|googlesyndication\.com|doubleclick\.net)$/;
const isDirect = l => { try { return new URL(l).protocol === 'https:' && !GOOGLE.test(new URL(l).hostname); } catch (e) { return false; } };
// Store priority: Amazon and Flipkart are listed before every other store; between them, the lower price first and Amazon on a tie.
const pri = n => { const t = String(n || '').trim(); return /^amazon|amazon\.in/i.test(t) ? 2 : /^flipkart|flipkart\.com/i.test(t) ? 1 : 0; };
const rank = (a, b) => ((a.price ?? a.extracted_price) - (b.price ?? b.extracted_price)) || (pri(b.store || b.source) - pri(a.store || a.source));
// Sorted by price (Amazon first on a tie), but the cheapest Amazon and Flipkart listings are always kept in the list when they exist.
const keepTop = (sorted, max, nameOf) => {
  const top = sorted.slice(0, max);
  [2, 1].forEach(p => { if (!top.some(x => pri(nameOf(x)) === p)) { const x = sorted.find(y => pri(nameOf(y)) === p); if (x) top.push(x); } });
  return top.sort(rank);
};
// Carrier-locked / US-import listings and import resellers are never a real Indian price.
const FOREIGN = /\b(verizon|at\s?&\s?t|t-?mobile|sprint|cricket wireless|metro ?pcs|boost mobile|us version|usa version|international version|carrier locked)\b/i;
const IMPORTER = /ubuy|aliexpress|alibaba|banggood|gearbest/i;
const lowMed = a => { const p = a.map(x => x.extracted_price).sort((x, y) => x - y); return p[Math.floor((p.length - 1) / 2)] || 0; };   // lower median: one huge outlier cannot move it
const median = a => { const p = a.map(x => x.extracted_price).sort((x, y) => x - y); return p[Math.floor(p.length / 2)] || 0; };
function cheapestPerStore(list, ratio, floor, max) {
  if (list.length > 2) { const m = median(list); list = list.filter(i => pri(i.source) || i.extracted_price >= Math.max(m * ratio, floor || 0)); }   // drop prices far below the median
  const by = new Map();
  list.forEach(i => { const c = by.get(i.source); if (!c || i.extracted_price < c.extracted_price) by.set(i.source, i); });
  const link = i => { const l = String(i.link || i.product_link || ''); return l.startsWith('https://') ? l : ''; };
  return keepTop([...by.values()].sort(rank), max, i => i.source).map(i => ({ store: String(i.source).slice(0, 40), price: Math.round(i.extracted_price),
    title: String(i.title || '').slice(0, 120), link: link(i), direct: isDirect(link(i)), token: String(i.immersive_product_page_token || ''), delivery: String(i.delivery || '').slice(0, 40), cond: cond(i) }));
}
// Category (from the AI, or guessed from the words) sets a minimum plausible price, so accessories such as skins, cases or
// stickers that slip through cannot be shown as the "lowest price" of a phone.
const SKINCARE_WORDS = /\b(cleanser|serum|moisturi[sz]er|sunscreen|lotion|cream|face|facial|spf|gel|toner|wash|acne|sensitive|oily|dry|\d+\s?(ml|gm|g))\b/i;
const OWN_CASE = /\b((wireless|magsafe|usb-?c|lightning|qi)\s+)*charging\s+case\b|\b(magsafe|usb-?c)\s+case\b/gi;   // "AirPods Pro 3 with MagSafe Charging Case" is the real product
const FOR_DEVICE = /\b(for|compatible with|fits?)\s+(apple\s+|samsung\s+|google\s+)?(airpods?|iphone|galaxy|pixel|buds)\b/i;   // "... for AirPods Pro 3"
const isAcc = t => { const x = String(t).replace(OWN_CASE, ' '); return ACC.test(x) || FOR_DEVICE.test(t) || (/\bskins?\b/i.test(t) && !SKINCARE_WORDS.test(t)); };
const FLOOR = { phone: 4000, laptop: 12000, tv: 4000, earbuds: 1500, skincare: 30 };
const BIG = ['phone', 'laptop', 'tv', 'earbuds'];   // exact model only, no "close matches"
const SPEC = /\b\d+\s?(gb|tb)\b|\b[45]g\b|smartphone/i;
function guessCategory(q) {
  if (/\b(airpods?|air pods?|earbuds?|earphones?|headphones?|headset|galaxy buds|pixel buds|buds ?\d|wh-?1000x?m?\d?|tws)\b/i.test(q)) return 'earbuds';
  if (/\b(serum|sunscreen|moisturi[sz]er|cleanser|face ?wash|toner|lotion|cream|spf|niacinamide|skincare)\b/i.test(q)) return 'skincare';
  if (/\b(laptop|macbook|thinkpad|notebook|ideapad|vivobook|zenbook|inspiron|pavilion)\b/i.test(q)) return 'laptop';
  if (/\b(tv|television|qled)\b/i.test(q)) return 'tv';
  if (/\b(iphone|galaxy|oneplus|pixel|redmi|poco|realme|vivo|oppo|iqoo|nothing phone|motorola|moto|xiaomi|samsung|nokia|infinix|tecno|lava|smartphone|mobile)\b|\b5g\b/i.test(q)) return 'phone';
  return 'other';
}
// Exact model matching. Titles and query are split into words (letters and digits apart: "S25FE" -> s 25 fe, "16e" -> 16 e).
// Every query word must appear in the title, and the word right after the model must not be a variant the shopper did not ask for
// (so "S25" never matches S25 FE / S25+ / S25 Ultra / S25 Edge, "iPhone 16" never matches 16e / Plus / Pro, "OnePlus 13" never matches 13R).
const VARIANT = new Set(['fe', 'plus', 'ultra', 'pro', 'max', 'edge', 'lite', 'mini', 'xl', 'fold', 'flip', 'neo', 'se', 'air', 'e', 'r', 't', 's', 'prime', 'power', 'turbo', 'gt', 'ace']);
const words = x => String(x || '').toLowerCase().replace(/\+/g, ' plus ').split(/[^a-z0-9]+/).filter(Boolean).flatMap(w => w.match(/[a-z]+|\d+/g) || []);
const st = w => (w.length > 4 && /[a-z]s$/.test(w) ? w.slice(0, -1) : w);   // airpods = airpod
function matches(title, q, checkVariants, loose) {
  const T = words(title), qset = new Set(words(q));
  for (const w of String(q).toLowerCase().replace(/\+/g, ' plus ').split(/\s+/).filter(Boolean)) {
    const ws = words(w); if (!ws.length) continue;
    let at = -1;
    for (let i = 0; i + ws.length <= T.length; i++) if (ws.every((x, j) => st(T[i + j]) === st(x))) { at = i; break; }
    if (at < 0 && loose && ws.length > 1 && ws.every(x => T.some(t => st(t) === st(x)))) continue;   // "3pro" vs "Pro 3": same words, other order
    if (at < 0) return false;
    const nxt = T[at + ws.length];
    if (checkVariants && nxt && VARIANT.has(nxt) && !qset.has(nxt)) return false;
  }
  return true;
}
// Result: { offers: new listings (cheapest per store), used: used/refurbished listings, img, relaxed, checkedAt }
function build(items, q, category) {
  if (process.env.DEBUG_STORES) console.log('stores from Google:', [...new Set(items.map(i => i.source))].join(', '));
  const cat = category || guessCategory(q), floor = FLOOR[cat] || 0, big = BIG.includes(cat);
  const wantsAcc = /case|cover|charger|cable|protector/i.test(q), toks = norm(q).split(' ').filter(Boolean);
  let ok = items.filter(i => typeof i.extracted_price === 'number' && i.extracted_price >= Math.max(1, floor) && i.source && !IMPORTER.test(String(i.source)) && !FOREIGN.test(String(i.title || '')) && (wantsAcc || !isAcc(String(i.title || ''))));
  if (cat === 'phone' && ok.some(i => SPEC.test(String(i.title)))) ok = ok.filter(i => SPEC.test(String(i.title)));   // real phones name storage or 5G
  const cv = cat !== 'skincare', rest = String(q).trim().split(/\s+/).slice(1).join(' ');
  let strict = ok.filter(i => matches(i.title, q, cv, cat === 'earbuds'));
  if (!strict.length && rest) strict = ok.filter(i => matches(i.title, rest, cv, cat === 'earbuds'));   // some titles leave out the brand
  const relaxed = !strict.length && ok.length > 0 && !big;   // phones, laptops and TVs: no "close match", only the exact model
  if (strict.length) ok = strict; else if (big) ok = [];
  let isNew = ok.filter(i => cond(i) === 'New'); const old = ok.filter(i => cond(i) !== 'New');
  if (big && isNew.length > 1) {   // far above the rest = import/odd listing; far below the middle = suspicious. Amazon/Flipkart are exempt from the low check only.
    const lm = lowMed(isNew); isNew = isNew.filter(i => i.extracted_price <= lm * 2.5);
    const md = median(isNew); isNew = isNew.filter(i => pri(i.source) || i.extracted_price >= md * 0.4);
  }
  const offers = cheapestPerStore(isNew, 0.5, 0, 6), usedFloor = Math.max(floor, offers.length ? median(isNew) * 0.2 : 0);
  const used = cheapestPerStore(old, 0.3, usedFloor, 5);
  const httpsThumb = i => String(i.thumbnail || '').startsWith('https://');
  const top = offers[0] && ok.find(i => String(i.source).slice(0, 40) === offers[0].store && Math.round(i.extracted_price) === offers[0].price);
  const th = ((top && httpsThumb(top) ? top : ok.find(httpsThumb)) || {}).thumbnail || '';
  return { relaxed, img: th, checkedAt: Date.now(), offers, used };
}
// Direct seller links + fuller store list: Google's list links usually go through Google, and the list shows one listing per store.
// The "immersive product" page of the cheapest listing has the stores' own product URLs and prices for that exact product
// (1 extra SerpApi credit). Those stores replace or extend the list; stores not found there keep their Google link.
async function fetchProduct(token) {
  const u = new URL('https://serpapi.com/search.json');
  Object.entries({ engine: 'google_immersive_product', page_token: token, api_key: process.env.SERPAPI_KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('immersive ' + r.status);
  return (await r.json()).product_results || {};
}
const skey = n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(com|in)$/, '');
async function resolveDirect(list, max = 8) {
  const first = list.find(o => o.token);
  if (!first) return { list, credits: 0 };
  try {
    const pr = await fetchProduct(first.token), merged = new Map();
    list.forEach(o => merged.set(skey(o.store), o));
    (pr.stores || []).forEach(s => {
      const price = Number(s.extracted_price) || parseFloat(String(s.price || '').replace(/[^0-9.]/g, ''));
      if (!isDirect(s.link) || !s.name) return;
      const key = skey(s.name), cur = merged.get(key);
      if (!(price > 0) || price < first.price * 0.5 || price > first.price * 2.5) { if (cur) merged.set(key, { ...cur, link: s.link, direct: true }); return; }   // missing or implausible price: keep ours   // no price given: keep ours, use their link
      merged.set(key, { store: String(s.name).slice(0, 40), price: Math.round(price), title: (cur && cur.title) || String(pr.title || first.title).slice(0, 120),
        link: s.link, direct: true, token: '', delivery: String(s.shipping || (cur && cur.delivery) || '').slice(0, 40), cond: first.cond });
    });
    return { credits: 1, list: keepTop([...merged.values()].sort(rank), max, o => o.store) };
  } catch (e) { console.error('direct links failed:', e.message); return { list, credits: 1 }; }
}
// Separate Amazon.in lookup (SerpApi "amazon" engine, 1 credit). Google Shopping in India often leaves Amazon out, so when it is missing
// we search amazon.in itself, keep only real listings of the exact model, and add the cheapest one to the list.
async function fetchAmazon(q) {
  const u = new URL('https://serpapi.com/search.json');
  Object.entries({ engine: 'amazon', k: q, amazon_domain: 'amazon.in', api_key: process.env.SERPAPI_KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('amazon ' + r.status);
  return (await r.json()).organic_results || [];
}
function pickAmazon(items, q, category, list) {
  const cat = category || guessCategory(q), floor = FLOOR[cat] || 0, big = BIG.includes(cat), cv = cat !== 'skincare';
  const wantsAcc = /case|cover|charger|cable|protector/i.test(q), md = median(list.map(o => ({ extracted_price: o.price })));
  const ok = items.filter(i => !i.sponsored && typeof i.extracted_price === 'number' && i.extracted_price >= Math.max(1, floor) && isDirect(String(i.link || ''))
    && !FOREIGN.test(String(i.title || '')) && (wantsAcc || !isAcc(String(i.title || ''))) && matches(i.title, q, cv, cat === 'earbuds') && (!big || !md || (i.extracted_price >= md * 0.4 && i.extracted_price <= md * 2.5)));
  if (cat === 'phone' && ok.some(i => SPEC.test(String(i.title)))) ok.splice(0, ok.length, ...ok.filter(i => SPEC.test(String(i.title))));
  const best = ok.sort((a, b) => a.extracted_price - b.extracted_price)[0];
  return best ? { store: 'Amazon.in', price: Math.round(best.extracted_price), title: String(best.title).slice(0, 120), link: best.link, direct: true, token: '', delivery: '', cond: 'New' } : null;
}
function addAmazon(list, az, max = 8) {
  if (!az || list.some(o => pri(o.store) === 2)) return list;
  return keepTop([...list, az].sort(rank), max, o => o.store);
}
const strip = list => list.map(({ token, ...o }) => o);
module.exports = { pri, fetchAmazon, pickAmazon, addAmazon, norm, fetchShopping, build, resolveDirect, strip, isDirect, guessCategory };
