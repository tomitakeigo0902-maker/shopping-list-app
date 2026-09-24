/**
 * prices.js - 💴 価格比較の画面
 *
 * Claudeがレシートや値札の写真から記録した「スーパーごとの価格」を
 * 商品ごとにまとめ、一番安い店を上に出す。
 *
 * 比較のルール:
 *  - 店ごとに「最新の通常価格」で比べる（特売で比べると、いつも安い店が分からなくなるため）
 *  - 通常価格より新しい特売があれば、参考として横に出す
 *  - 通常価格の記録が無い店は、特売価格で代用し「特売」と明示する
 */
'use strict';

const Prices = (() => {
  const KEY_CACHE = 'sl_prices_cache';
  let records = [];
  let query = '';
  const openNames = new Set(); // 履歴を開いている商品

  function _read(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
  function _write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

  // 表記ゆれ（全角/半角・余計な空白）を吸収して同じ商品として扱う
  function norm(s) { return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim(); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function md(date) {
    if (!date) return '';
    const d = new Date(date);
    return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function yen(n) { return '¥' + Number(n).toLocaleString(); }

  function load() { records = _read(KEY_CACHE, []); return records; }

  async function refresh() {
    if (!window.Sync || !Sync.isConfigured() || !Sync.pullPrices) return;
    try {
      records = await Sync.pullPrices();
      _write(KEY_CACHE, records);
      render();
    } catch {
      // 圏外などで取れないときは前回の内容を表示し続ける
    }
  }

  // 商品ごと・店ごとに最新価格を集計する
  function summarize() {
    const byProduct = new Map();
    for (const r of records) {
      const name = norm(r.name);
      const price = Number(r.price);
      if (!name || !(price > 0)) continue;
      if (!byProduct.has(name)) {
        byProduct.set(name, { name, category: r.category || 'その他', stores: new Map(), history: [] });
      }
      const p = byProduct.get(name);
      if (r.category) p.category = r.category;
      p.history.push(r);

      const storeName = norm(r.store) || '店名なし';
      if (!p.stores.has(storeName)) p.stores.set(storeName, { store: storeName, regular: null, sale: null });
      const s = p.stores.get(storeName);
      const slot = r.sale ? 'sale' : 'regular';
      if (!s[slot] || (r.date || '') > (s[slot].date || '')) s[slot] = r;
    }

    const products = [];
    for (const p of byProduct.values()) {
      const stores = [...p.stores.values()].map(s => {
        const base = s.regular || s.sale;
        const newerSale = s.regular && s.sale && (s.sale.date || '') >= (s.regular.date || '') ? s.sale : null;
        return {
          store: s.store,
          price: Number(base.price),
          date: base.date,
          saleOnly: !s.regular,          // 特売の記録しか無い
          salePrice: newerSale ? Number(newerSale.price) : null,
        };
      }).sort((a, b) => a.price - b.price || (b.date || '').localeCompare(a.date || ''));

      p.history.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      products.push({ ...p, stores, best: stores[0] });
    }
    return products;
  }

  // 「何品目で最安だったか」の店ランキング（2店舗以上で比べられた商品だけを数える）
  function ranking(products) {
    const count = new Map();
    for (const p of products) {
      if (p.stores.length < 2) continue;
      const top = p.stores[0];
      if (p.stores[1] && p.stores[1].price === top.price) continue; // 同額は数えない
      count.set(top.store, (count.get(top.store) || 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }

  function categoryOrder(cat) {
    const list = (window.Store && Store.CATEGORIES) || [];
    const i = list.findIndex(c => c.key === cat);
    return i < 0 ? 999 : i;
  }

  function catInfo(cat) {
    return (window.Store && Store.getCategoryInfo) ? Store.getCategoryInfo(cat) : { icon: '📦', color: '#888' };
  }

  function render() {
    const host = document.getElementById('priceList');
    const empty = document.getElementById('priceEmpty');
    const rankEl = document.getElementById('priceRanking');
    if (!host) return;

    const all = summarize();
    const q = norm(query).toLowerCase();
    const list = all
      .filter(p => !q || p.name.toLowerCase().includes(q) || [...p.stores].some(s => s.store.toLowerCase().includes(q)))
      .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.name.localeCompare(b.name, 'ja'));

    // 店ランキング
    const rank = ranking(all);
    if (rankEl) {
      rankEl.innerHTML = rank.length
        ? `<div class="price-rank__title">最安になった商品数</div>
           <div class="price-rank__items">${rank.slice(0, 5).map(([store, n], i) =>
             `<span class="price-rank__item${i === 0 ? ' price-rank__item--top' : ''}">${i === 0 ? '🏆 ' : ''}${esc(store)} <b>${n}</b></span>`
           ).join('')}</div>`
        : '';
      rankEl.style.display = rank.length ? '' : 'none';
    }

    if (!list.length) {
      host.innerHTML = '';
      if (empty) {
        empty.style.display = 'flex';
        const sub = empty.querySelector('.empty-state__sub');
        if (sub) sub.textContent = all.length ? '該当する商品がありません' : 'Claudeにレシートや値札の写真を送ると、ここに記録されます';
      }
      return;
    }
    if (empty) empty.style.display = 'none';

    let html = '';
    let lastCat = null;
    for (const p of list) {
      if (p.category !== lastCat) {
        const ci = catInfo(p.category);
        html += `<div class="price-cat"><span class="price-cat__dot" style="background:${ci.color}"></span>${ci.icon} ${esc(p.category)}</div>`;
        lastCat = p.category;
      }
      const comparable = p.stores.length >= 2;
      const rows = p.stores.map((s, i) => {
        const isBest = i === 0 && comparable;
        const tags = [];
        if (s.saleOnly) tags.push('<span class="price-tag price-tag--sale">特売</span>');
        if (s.salePrice != null) tags.push(`<span class="price-tag price-tag--sale">特売${yen(s.salePrice)}</span>`);
        return `<div class="price-row${isBest ? ' price-row--best' : ''}">
          <span class="price-row__store">${isBest ? '🏆 ' : ''}${esc(s.store)}</span>
          <span class="price-row__tags">${tags.join('')}</span>
          <span class="price-row__price">${yen(s.price)}</span>
          <span class="price-row__date">${md(s.date)}</span>
        </div>`;
      }).join('');

      const open = openNames.has(p.name);
      const hist = open ? `<div class="price-hist">${p.history.map(h =>
        `<div class="price-hist__row">
          <span>${md(h.date)}</span><span>${esc(h.store || '')}</span>
          <span>${yen(h.price)}${h.sale ? ' <em>特売</em>' : ''}</span>
        </div>${h.memo ? `<div class="price-hist__memo">${esc(h.memo)}</div>` : ''}`
      ).join('')}</div>` : '';

      html += `<div class="price-card${open ? ' price-card--open' : ''}" data-name="${esc(p.name)}">
        <div class="price-card__head">
          <span class="price-card__name">${esc(p.name)}</span>
          <span class="price-card__meta">${comparable ? `${p.stores.length}店舗` : '比較待ち'}</span>
        </div>
        ${rows}
        ${hist}
      </div>`;
    }
    host.innerHTML = html;
  }

  function bind() {
    const input = document.getElementById('priceSearch');
    if (input) input.addEventListener('input', () => { query = input.value; render(); });
    const host = document.getElementById('priceList');
    if (host) {
      host.addEventListener('click', e => {
        const card = e.target.closest('.price-card');
        if (!card) return;
        const name = card.dataset.name;
        openNames.has(name) ? openNames.delete(name) : openNames.add(name);
        render();
      });
    }
  }

  return { load, render, refresh, bind };
})();

// 他のスクリプトから window.Prices で参照できるようにする
window.Prices = Prices;
