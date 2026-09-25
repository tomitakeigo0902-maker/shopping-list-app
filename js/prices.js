/**
 * prices.js - 💴 価格比較の画面
 *
 * Claudeがレシートや値札の写真から記録した「スーパーごとの価格」を
 * 商品ごとにまとめ、一番安い店を上に出す。
 *
 * 比較のルール:
 *  - 商品名の末尾の容量（「冷凍ブロッコリー 500g」の 500g）を読み取り、
 *    その手前の一般名が同じなら、容量が違っても同じ商品として比べる
 *  - 容量が違う記録が混ざる商品は、100gあたり（液体は100ml、個数物は1個あたり）の単価で比べる
 *  - 店×容量ごとに「最新の通常価格」を使う（特売で比べると、いつも安い店が分からなくなるため）
 *  - 通常価格より新しい特売があれば参考として横に出す。特売の記録しか無ければ特売価格で代用する
 */
'use strict';

const Prices = (() => {
  const KEY_CACHE = 'sl_prices_cache';
  let records = [];
  let query = '';
  const openKeys = new Set(); // 履歴を開いている商品

  function _read(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
  function _write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

  // 表記ゆれ（全角/半角・余計な空白）を吸収する
  function norm(s) { return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, ' ').trim(); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ===== 商品名から容量を読み取る =====
  // 「一般名 数量単位」の形を想定。重さはg、液体はmlにそろえ、×3 のまとめ売りは掛け算する。
  // 「6枚切」のような切り方は量ではないので、あえて読み取らない（一致しない）。
  const COUNT_UNITS = '個|枚|本|袋|パック|玉|切れ|切|株|缶|箱|房|束|尾|匹|食|人前|丁|粒|包|杯';
  const SIZE_RE = new RegExp(
    '(\\d+(?:\\.\\d+)?)\\s*(kg|g|ml|L|l|' + COUNT_UNITS + ')' +
    '(?:\\s*[×xX*]\\s*(\\d+)\\s*(?:' + COUNT_UNITS + ')?)?' +
    '\\s*(?:当たり|あたり|入り|入)?$', 'i'
  );

  function parseSize(rawName) {
    const name = norm(rawName);
    const m = name.match(SIZE_RE);
    if (!m) return { base: name, amount: null, unit: null };
    let amount = parseFloat(m[1]);
    let unit = m[2];
    if (/^kg$/i.test(unit)) { amount *= 1000; unit = 'g'; }
    else if (/^g$/i.test(unit)) unit = 'g';
    else if (/^ml$/i.test(unit)) unit = 'ml';
    else if (/^l$/i.test(unit)) { amount *= 1000; unit = 'ml'; }
    if (unit === '切れ') unit = '切';
    if (m[3]) amount *= parseInt(m[3], 10);
    const base = name.slice(0, m.index).replace(/[\s・,、(（]+$/, '').trim();
    if (!base || !(amount > 0)) return { base: name, amount: null, unit: null };
    return { base, amount, unit };
  }

  // 単価の基準（重さ・液体は100あたり、個数物は1あたり）
  function basisOf(unit) {
    if (unit === 'g') return { per: 100, label: '100gあたり' };
    if (unit === 'ml') return { per: 100, label: '100mlあたり' };
    if (unit) return { per: 1, label: `1${unit}あたり` };
    return null;
  }

  // ===== 表示用の書式 =====
  function yen(n) { return '¥' + Math.round(Number(n)).toLocaleString(); }
  function unitYen(n) {
    const v = Number(n);
    return '¥' + (v < 100 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toLocaleString());
  }
  function sizeLabel(amount, unit) {
    if (amount == null) return '';
    if (unit === 'g' && amount >= 1000 && amount % 100 === 0) return `${amount / 1000}kg`;
    if (unit === 'ml' && amount >= 1000 && amount % 100 === 0) return `${amount / 1000}L`;
    return `${amount}${unit}`;
  }
  function md(date) {
    if (!date) return '';
    const d = new Date(date);
    return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
  }

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

  // ===== 集計 =====
  // 一般名＋単位の種類ごとに1商品。その中を「店×容量」ごとの行に分ける。
  function summarize() {
    const groups = new Map();
    for (const r of records) {
      const price = Number(r.price);
      if (!(price > 0)) continue;
      const sz = parseSize(r.name);
      if (!sz.base) continue;

      const key = sz.base + '|' + (sz.unit || '');
      if (!groups.has(key)) {
        groups.set(key, { key, base: sz.base, unit: sz.unit, category: r.category || 'その他', rows: new Map(), history: [] });
      }
      const g = groups.get(key);
      if (r.category) g.category = r.category;
      g.history.push({ ...r, amount: sz.amount, unit: sz.unit });

      const store = norm(r.store) || '店名なし';
      const rowKey = store + '|' + (sz.amount == null ? '' : sz.amount);
      if (!g.rows.has(rowKey)) g.rows.set(rowKey, { store, amount: sz.amount, regular: null, sale: null });
      const row = g.rows.get(rowKey);
      const slot = r.sale ? 'sale' : 'regular';
      if (!row[slot] || (r.date || '') > (row[slot].date || '')) row[slot] = r;
    }

    // 同じ一般名で単位の種類が複数ある場合（例: キャベツ 1玉 と キャベツ 500g）は見出しで区別する
    const dimsPerBase = new Map();
    for (const g of groups.values()) dimsPerBase.set(g.base, (dimsPerBase.get(g.base) || 0) + 1);

    const products = [];
    for (const g of groups.values()) {
      const basis = basisOf(g.unit);
      const rows = [...g.rows.values()].map(row => {
        const pick = row.regular || row.sale;
        const price = Number(pick.price);
        const salePrice = row.regular && row.sale && (row.sale.date || '') >= (row.regular.date || '')
          ? Number(row.sale.price) : null;
        const perUnit = (p) => (basis && row.amount ? p / row.amount * basis.per : null);
        return {
          store: row.store,
          amount: row.amount,
          price,
          unitPrice: perUnit(price),
          date: pick.date,
          saleOnly: !row.regular,
          salePrice,
          saleUnitPrice: salePrice != null ? perUnit(salePrice) : null,
        };
      });

      const multiSize = new Set(rows.map(r => r.amount)).size > 1;
      const cmp = r => (multiSize && r.unitPrice != null ? r.unitPrice : r.price);
      rows.sort((a, b) => cmp(a) - cmp(b) || (b.date || '').localeCompare(a.date || ''));
      g.history.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      products.push({
        key: g.key,
        name: g.base,
        title: dimsPerBase.get(g.base) > 1 && basis ? `${g.base}（${basis.label}）` : g.base,
        category: g.category,
        unit: g.unit,
        basis,
        multiSize,
        cmp,
        rows,
        storeCount: new Set(rows.map(r => r.store)).size,
        history: g.history,
      });
    }
    return products;
  }

  // 「何品目で最安だったか」の店ランキング（2店舗以上で比べられた商品だけを数える）
  function ranking(products) {
    const count = new Map();
    for (const p of products) {
      if (p.storeCount < 2) continue;
      const top = p.rows[0];
      const rival = p.rows.find(r => r.store !== top.store);
      if (rival && p.cmp(rival) === p.cmp(top)) continue; // 同じ単価は数えない
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

  // ===== 描画 =====
  function render() {
    const host = document.getElementById('priceList');
    const empty = document.getElementById('priceEmpty');
    const rankEl = document.getElementById('priceRanking');
    if (!host) return;

    const all = summarize();
    const q = norm(query).toLowerCase();
    const list = all
      .filter(p => !q || p.name.toLowerCase().includes(q) || p.rows.some(r => r.store.toLowerCase().includes(q)))
      .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.title.localeCompare(b.title, 'ja'));

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

      const comparable = p.rows.length >= 2;
      const showUnit = p.multiSize && p.basis;
      const singleSize = !p.multiSize && p.rows[0] && p.rows[0].amount != null
        ? sizeLabel(p.rows[0].amount, p.unit) : '';

      // 見出し右側: 何で比べているか
      let meta;
      if (showUnit) meta = `${p.basis.label}で比較`;
      else if (p.storeCount >= 2) meta = `${singleSize ? singleSize + '・' : ''}${p.storeCount}店舗`;
      else meta = `${singleSize ? singleSize + '・' : ''}比較待ち`;

      const rows = p.rows.map((r, i) => {
        const isBest = i === 0 && comparable;
        const trophy = isBest && p.storeCount >= 2 ? '🏆 ' : '';
        const tags = [];
        if (showUnit) tags.push(`<span class="price-tag price-tag--size">${esc(sizeLabel(r.amount, p.unit))}</span>`);
        if (r.saleOnly) tags.push('<span class="price-tag price-tag--sale">特売</span>');
        // 単価で比べている商品は、特売も単価で出す（横の数字と単位をそろえる）
        if (r.salePrice != null) {
          tags.push(`<span class="price-tag price-tag--sale">特売${showUnit ? unitYen(r.saleUnitPrice) : yen(r.salePrice)}</span>`);
        }
        return `<div class="price-row${isBest ? ' price-row--best' : ''}">
          <span class="price-row__store">${trophy}${esc(r.store)}</span>
          <span class="price-row__tags">${tags.join('')}</span>
          <span class="price-row__price">${showUnit
            ? `<span class="price-row__unit">${unitYen(r.unitPrice)}</span><span class="price-row__pack">${yen(r.price)}</span>`
            : yen(r.price)}</span>
          <span class="price-row__date">${md(r.date)}</span>
        </div>`;
      }).join('');

      const open = openKeys.has(p.key);
      const hist = open ? `<div class="price-hist">${p.history.map(h =>
        `<div class="price-hist__row">
          <span>${md(h.date)}</span>
          <span>${esc(h.store || '')}${h.amount != null ? ` <small>${esc(sizeLabel(h.amount, h.unit))}</small>` : ''}</span>
          <span>${yen(h.price)}${h.sale ? ' <em>特売</em>' : ''}</span>
        </div>${h.memo ? `<div class="price-hist__memo">${esc(h.memo)}</div>` : ''}`
      ).join('')}</div>` : '';

      html += `<div class="price-card${open ? ' price-card--open' : ''}" data-key="${esc(p.key)}">
        <div class="price-card__head">
          <span class="price-card__name">${esc(p.title)}</span>
          <span class="price-card__meta">${esc(meta)}</span>
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
        const key = card.dataset.key;
        openKeys.has(key) ? openKeys.delete(key) : openKeys.add(key);
        render();
      });
    }
  }

  return { load, render, refresh, bind, parseSize };
})();

// 他のスクリプトから window.Prices で参照できるようにする
window.Prices = Prices;
