// app.js - Main Application Logic
'use strict';

const App = (() => {
  let currentView = 'list';
  let editingItemId = null;
  let selectedCategory = '食品';
  let confirmCallback = null;
  let toastTimer = null;

  // Auto-suggest state: manual edits win over suggestions within a modal session
  let categoryTouched = false;
  let unitTouched = false;
  let suggestTimer = null;

  // Touch swipe state
  let touchStartX = 0;
  let touchStartY = 0;
  let touchCurrentX = 0;
  let swipingEl = null;
  let swipeDirection = null;
  let startTranslateX = 0;

  // === Utility ===
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (itemDate.getTime() === today.getTime()) return '今日';
    if (itemDate.getTime() === yesterday.getTime()) return '昨日';
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function groupByCategory(items) {
    const groups = {};
    const order = CATEGORIES.map(c => c.key);
    items.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return order.filter(key => groups[key]).map(key => ({
      category: key,
      items: groups[key]
    }));
  }

  function groupByDate(historyItems) {
    const groups = {};
    historyItems.forEach(item => {
      const dateKey = formatDate(item.checkedAt);
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(item);
    });
    return Object.entries(groups).map(([date, items]) => ({ date, items }));
  }

  // === Toast ===
  function showToast(message, optionsOrDuration = 2000) {
    const opts = typeof optionsOrDuration === 'number'
      ? { duration: optionsOrDuration }
      : optionsOrDuration;
    const duration = opts.duration || 2000;
    const action = opts.action || null;

    const el = document.getElementById('toast');
    el.innerHTML = '';
    el.classList.toggle('toast--with-action', !!action);

    const msg = document.createElement('span');
    msg.className = 'toast__message';
    msg.textContent = message;
    el.appendChild(msg);

    if (action) {
      const btn = document.createElement('button');
      btn.className = 'toast__action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        action.callback();
        hideToast();
      });
      el.appendChild(btn);
    }

    el.classList.add('toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, duration);
  }

  function hideToast() {
    const el = document.getElementById('toast');
    el.classList.remove('toast--show');
    el.classList.remove('toast--with-action');
  }

  // === Confirm Dialog ===
  function showConfirm(message, okText, callback) {
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmOk').textContent = okText;
    document.getElementById('confirmBackdrop').classList.add('confirm-backdrop--active');
    document.getElementById('confirmDialog').classList.add('confirm-dialog--active');
    confirmCallback = callback;
  }

  function hideConfirm() {
    document.getElementById('confirmBackdrop').classList.remove('confirm-backdrop--active');
    document.getElementById('confirmDialog').classList.remove('confirm-dialog--active');
    confirmCallback = null;
  }

  // === View Switching ===
  function switchView(viewName) {
    currentView = viewName;

    document.querySelectorAll('.view').forEach(v => v.classList.remove('view--active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('nav-tab--active'));

    const viewMap = { list: 'viewList', history: 'viewHistory', favorites: 'viewFavorites' };
    document.getElementById(viewMap[viewName]).classList.add('view--active');
    document.querySelector(`[data-view="${viewName}"]`).classList.add('nav-tab--active');

    const fab = document.getElementById('fabAdd');
    const headerAction = document.getElementById('headerAction');
    const headerTitle = document.querySelector('.header__title');

    if (viewName === 'list') {
      fab.classList.remove('fab--hidden');
      headerTitle.textContent = '🛒 買い物リスト';
      headerAction.style.display = 'none';
      renderList();
    } else if (viewName === 'history') {
      fab.classList.add('fab--hidden');
      headerTitle.textContent = '📋 購入履歴';
      const hasHistory = Store.history.getAll().length > 0;
      headerAction.style.display = hasHistory ? 'flex' : 'none';
      headerAction.setAttribute('aria-label', '履歴をクリア');
      renderHistory();
    } else if (viewName === 'favorites') {
      fab.classList.add('fab--hidden');
      headerTitle.textContent = '⭐ お気に入り';
      headerAction.style.display = 'none';
      renderFavorites();
    }
  }

  // === Render: List ===
  function renderList() {
    const items = Store.items.getAll();
    const container = document.getElementById('itemList');
    const empty = document.getElementById('emptyList');

    if (items.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    let html = '';
    const groups = groupByCategory(items);
    groups.forEach(group => {
      const catInfo = Store.getCategoryInfo(group.category);
      html += `<div class="category-group">
        <div class="category-group__header">
          <span class="category-group__dot" style="background:${catInfo.color}"></span>
          <span>${catInfo.icon} ${escapeHtml(group.category)}</span>
        </div>`;
      group.items.forEach(item => {
        html += renderItemCard(item, catInfo);
      });
      html += '</div>';
    });

    container.innerHTML = html;
  }

  function renderItemCard(item, catInfo) {
    const qtyText = item.quantity > 1 || item.unit !== '個' ? `${item.quantity}${item.unit}` : '';
    const memoText = item.memo ? `📝 ${escapeHtml(item.memo)}` : '';
    const metaParts = [qtyText, memoText].filter(Boolean).join(' ');
    const priceHtml = item.price ? `<span class="item-card__price">¥${Number(item.price).toLocaleString()}</span>` : '';

    return `<div class="item-card" data-id="${item.id}">
      <div class="item-card__actions">
        <div class="item-card__action-delete" data-action="delete" data-id="${item.id}">削除</div>
      </div>
      <div class="item-card__content" style="border-left-color:${catInfo.color}">
        <div class="item-card__check" data-action="check" data-id="${item.id}"></div>
        <div class="item-card__info" data-action="edit" data-id="${item.id}">
          <div class="item-card__name">${escapeHtml(item.name)}</div>
          ${metaParts ? `<div class="item-card__meta">${metaParts}</div>` : ''}
        </div>
        ${priceHtml}
      </div>
    </div>`;
  }

  // === Render: History ===
  function renderHistory() {
    const all = Store.history.getAll();
    const container = document.getElementById('historyList');
    const empty = document.getElementById('emptyHistory');

    if (all.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    const groups = groupByDate(all);
    let html = '';
    groups.forEach(group => {
      html += `<div class="history-group">
        <div class="history-group__header">${escapeHtml(group.date)}</div>`;
      group.items.forEach(item => {
        const catInfo = Store.getCategoryInfo(item.category);
        const qty = item.quantity > 1 || item.unit !== '個' ? ` ${item.quantity}${item.unit}` : '';
        const priceHtml = item.price ? `<span class="history-item__price">¥${Number(item.price).toLocaleString()}</span>` : '';
        html += `<div class="history-item" data-id="${item.id}">
          <div class="history-item__actions">
            <div class="history-item__action-delete" data-action="delete-hist" data-id="${item.id}">削除</div>
          </div>
          <div class="history-item__content" data-action="readd" data-name="${escapeHtml(item.itemName)}" data-category="${escapeHtml(item.category)}" data-quantity="${item.quantity}" data-unit="${escapeHtml(item.unit)}" data-memo="${escapeHtml(item.memo || '')}" data-price="${item.price || ''}" style="border-left-color:${catInfo.color}">
            <div class="history-item__info">
              <div class="history-item__name">${catInfo.icon} ${escapeHtml(item.itemName)}${qty}</div>
              <div class="history-item__meta">${formatTime(item.checkedAt)}${item.memo ? ' · ' + escapeHtml(item.memo) : ''}</div>
            </div>
            ${priceHtml}
            <div class="history-item__add">＋</div>
          </div>
        </div>`;
      });
      html += '</div>';
    });

    container.innerHTML = html;
  }

  // === Render: Favorites ===
  function renderFavorites() {
    const all = Store.favorites.getAll();
    const container = document.getElementById('favoritesList');
    const empty = document.getElementById('emptyFavorites');

    if (all.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    let html = '';
    all.forEach(fav => {
      const catInfo = Store.getCategoryInfo(fav.category);
      const qty = fav.quantity > 1 || fav.unit !== '個' ? ` ${fav.quantity}${fav.unit}` : '';
      html += `<div class="favorite-card" style="border-left-color:${catInfo.color}" data-id="${fav.id}">
        <div class="favorite-card__icon">${catInfo.icon}</div>
        <div class="favorite-card__info">
          <div class="favorite-card__name">${escapeHtml(fav.name)}${qty}</div>
          <div class="favorite-card__meta">${escapeHtml(fav.category)} · ${fav.usageCount}回使用</div>
        </div>
        <button class="favorite-card__add" data-action="quickadd" data-id="${fav.id}" aria-label="リストに追加">＋</button>
        <button class="favorite-card__remove" data-action="removefav" data-id="${fav.id}" aria-label="お気に入りから削除">✕</button>
      </div>`;
    });

    container.innerHTML = html;
  }

  // === URL Fetch ===
  const CORS_PROXIES = [
    url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    url => 'https://corsproxy.io/?' + encodeURIComponent(url),
    url => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url)
  ];

  async function fetchViaProxy(url) {
    for (const makeProxy of CORS_PROXIES) {
      try {
        const proxyUrl = makeProxy(url);
        const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const text = await res.text();
        // Reject if too short (likely error page) or clearly not HTML
        if (text.length < 200) continue;
        return text;
      } catch {
        continue;
      }
    }
    return null;
  }

  function extractTitle(doc, html) {
    // 1. og:title
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.getAttribute('content')) return ogTitle.getAttribute('content');
    // 2. title tag
    if (doc.title) return doc.title;
    // 3. h1
    const h1 = doc.querySelector('h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    // 4. Amazon specific: #productTitle
    const amzTitle = doc.getElementById('productTitle');
    if (amzTitle) return amzTitle.textContent.trim();
    return '';
  }

  function extractPrice(doc, html) {
    const extractors = [
      // JSON-LD structured data
      () => {
        const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
        for (const s of scripts) {
          try {
            const json = JSON.parse(s.textContent);
            const findPrice = (obj) => {
              if (!obj || typeof obj !== 'object') return null;
              if (obj.price != null) return String(obj.price).replace(/[^0-9.]/g, '');
              if (obj.lowPrice != null) return String(obj.lowPrice).replace(/[^0-9.]/g, '');
              if (obj.offers) return findPrice(obj.offers);
              if (Array.isArray(obj)) {
                for (const item of obj) { const r = findPrice(item); if (r) return r; }
              }
              for (const v of Object.values(obj)) {
                if (v && typeof v === 'object') { const r = findPrice(v); if (r) return r; }
              }
              return null;
            };
            const p = findPrice(json);
            if (p) return p.split('.')[0]; // integer yen
          } catch {}
        }
        return null;
      },
      // og:price / product:price meta
      () => {
        const meta = doc.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]');
        return meta ? meta.getAttribute('content').replace(/[^0-9]/g, '') : null;
      },
      // Amazon specific: .a-price .a-offscreen or #priceblock_ourprice
      () => {
        const el = doc.querySelector('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .a-price-whole, #corePrice_feature_div .a-offscreen');
        if (el) {
          const text = el.textContent.trim();
          const m = text.match(/([\d,]+)/);
          return m ? m[1].replace(/,/g, '') : null;
        }
        return null;
      },
      // Rakuten specific
      () => {
        const el = doc.querySelector('.price2, .important, [class*="price"] .value');
        if (el) {
          const m = el.textContent.match(/([\d,]+)/);
          return m ? m[1].replace(/,/g, '') : null;
        }
        return null;
      },
      // Generic price patterns in HTML: ¥1,234 / ￥1,234 / 1,234円
      () => {
        // Look for price near keywords
        const priceArea = html.match(/(?:価格|Price|price|販売価格|セール|sale)[^<]{0,100}[¥￥]\s*([\d,]+)/i);
        if (priceArea) return priceArea[1].replace(/,/g, '');
        const priceArea2 = html.match(/(?:価格|Price|price|販売価格)[^<]{0,100}([\d,]+)\s*円/i);
        if (priceArea2) return priceArea2[1].replace(/,/g, '');
        // Broader search
        const m = html.match(/[¥￥]\s*([\d,]{3,})/);
        if (m) return m[1].replace(/,/g, '');
        const m2 = html.match(/([\d,]{3,})\s*円/);
        if (m2) return m2[1].replace(/,/g, '');
        return null;
      }
    ];

    for (const fn of extractors) {
      const result = fn();
      if (result && result.length > 0 && result.length < 10 && parseInt(result) > 0) {
        return result;
      }
    }
    return '';
  }

  function cleanTitle(raw) {
    if (!raw) return '';
    // Remove common suffixes: " | Amazon", " - 楽天市場", etc.
    let t = raw
      .replace(/\s*[\|–\-:]\s*(Amazon|amazon|アマゾン|楽天市場|楽天|Yahoo|YAHOO|ヤフー|ZOZOTOWN|メルカリ|PayPay)[^|–\-]*$/i, '')
      .replace(/\s*[\|–\-]\s*[^|–\-]*$/, '')
      .replace(/^(by\s+Amazon\s+|Amazon\.co\.jp[:\s]*|Amazon[:\s]+)/i, '')
      .replace(/【[^】]*】/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .trim();
    if (t.length > 80) t = t.substring(0, 80);
    return t;
  }

  async function fetchUrlInfo(url) {
    const btn = document.getElementById('btnFetchUrl');
    const statusEl = document.getElementById('urlStatus');
    const btnText = btn.querySelector('.btn-url-fetch__text');
    const btnLoading = btn.querySelector('.btn-url-fetch__loading');

    btn.classList.add('btn-url-fetch--loading');
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    statusEl.textContent = '読み取り中...';
    statusEl.className = 'url-status';

    try {
      const html = await fetchViaProxy(url);
      if (!html) throw new Error('取得失敗');

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const rawTitle = extractTitle(doc, html);
      const title = cleanTitle(rawTitle);
      const price = extractPrice(doc, html);

      if (title) {
        document.getElementById('inputName').value = title;
        applySuggestion();
      }
      if (price) {
        document.getElementById('inputPrice').value = price;
      }

      const parts = [];
      if (title) parts.push('商品名を取得');
      if (price) parts.push('価格を取得');

      if (parts.length > 0) {
        statusEl.textContent = '✓ ' + parts.join('・');
        statusEl.className = 'url-status url-status--success';
      } else {
        statusEl.textContent = '情報を取得できませんでした（サイトが対応していない可能性があります）';
        statusEl.className = 'url-status url-status--error';
      }
    } catch (e) {
      statusEl.textContent = '読み取りに失敗しました（別のURLを試してみてください）';
      statusEl.className = 'url-status url-status--error';
    } finally {
      btn.classList.remove('btn-url-fetch--loading');
      btnText.style.display = 'inline';
      btnLoading.style.display = 'none';
    }
  }

  // === Modal ===
  function openModal(mode, item) {
    editingItemId = mode === 'edit' ? item.id : null;

    document.getElementById('modalTitle').textContent = mode === 'edit' ? '商品を編集' : '商品を追加';
    document.getElementById('btnSubmit').textContent = mode === 'edit' ? '更新' : '追加';

    document.getElementById('inputName').value = item ? item.name : '';
    document.getElementById('inputQuantity').value = item ? item.quantity : 1;
    document.getElementById('inputMemo').value = item ? item.memo || '' : '';
    document.getElementById('inputPrice').value = item ? item.price || '' : '';
    document.getElementById('inputUrl').value = item ? item.url || '' : '';
    document.getElementById('urlStatus').textContent = '';
    document.getElementById('urlStatus').className = 'url-status';

    // Set unit
    const unitSelect = document.getElementById('inputUnit');
    if (item) unitSelect.value = item.unit;
    else unitSelect.value = '個';

    // Set category
    selectedCategory = item ? item.category : '食品';
    renderCategoryChips();

    // 編集時は既存の値を尊重（自動サジェストで上書きしない）、追加時は自動サジェスト有効
    categoryTouched = mode === 'edit';
    unitTouched = mode === 'edit';
    clearTimeout(suggestTimer);
    document.getElementById('suggestHint').textContent = '';

    document.getElementById('modalBackdrop').classList.add('modal-backdrop--active');
    document.getElementById('itemModal').classList.add('modal--active');

    setTimeout(() => document.getElementById('inputName').focus(), 300);
  }

  function closeModal() {
    document.getElementById('modalBackdrop').classList.remove('modal-backdrop--active');
    document.getElementById('itemModal').classList.remove('modal--active');
    editingItemId = null;
  }

  function renderCategoryChips() {
    const container = document.getElementById('categoryChips');
    container.innerHTML = CATEGORIES.map(cat => {
      const selected = cat.key === selectedCategory;
      const style = selected
        ? `background:${cat.color}; color:#fff; border-color:transparent;`
        : `border-color:${cat.color}40; color:${cat.color};`;
      return `<button type="button" class="category-chip${selected ? ' category-chip--selected' : ''}" data-category="${escapeHtml(cat.key)}" style="${style}">${cat.icon} ${escapeHtml(cat.key)}</button>`;
    }).join('');
  }

  function renderUnitOptions() {
    const select = document.getElementById('inputUnit');
    select.innerHTML = UNITS.map(u =>
      `<option value="${escapeHtml(u)}">${u || 'なし'}</option>`
    ).join('');
  }

  // === Auto-suggest category & unit from item name ===
  function applySuggestion() {
    const name = document.getElementById('inputName').value.trim();
    const hintEl = document.getElementById('suggestHint');
    if (!name || (categoryTouched && unitTouched)) {
      hintEl.textContent = '';
      return;
    }

    const s = Store.suggest(name);
    if (!s) {
      hintEl.textContent = '';
      return;
    }

    const applied = [];
    if (!categoryTouched && s.category && s.category !== selectedCategory) {
      selectedCategory = s.category;
      renderCategoryChips();
    }
    if (!categoryTouched && s.category) {
      const catInfo = Store.getCategoryInfo(s.category);
      applied.push(`${catInfo.icon} ${s.category}`);
    }
    if (!unitTouched && s.unit !== undefined) {
      document.getElementById('inputUnit').value = s.unit;
      applied.push(s.unit || '単位なし');
    }

    hintEl.textContent = applied.length ? `${applied.join(' / ')} を自動設定` : '';
  }

  function handleModalSubmit() {
    const name = document.getElementById('inputName').value.trim();
    if (!name) return;

    const priceVal = document.getElementById('inputPrice').value;
    const data = {
      name,
      category: selectedCategory,
      quantity: Math.max(1, Math.min(99, parseInt(document.getElementById('inputQuantity').value) || 1)),
      unit: document.getElementById('inputUnit').value,
      memo: document.getElementById('inputMemo').value.trim(),
      price: priceVal ? parseInt(priceVal) : '',
      url: document.getElementById('inputUrl').value.trim()
    };

    if (editingItemId) {
      Store.items.update(editingItemId, data);
      queueSync({ type: 'update', localId: editingItemId, payload: data });
      showToast('更新しました');
    } else {
      const created = Store.items.add(data);
      queueSync({ type: 'create', localId: created.id, payload: data });
      showToast(`${name} を追加しました`);
    }

    closeModal();
    renderList();
  }

  // === Swipe Handling ===
  function getTranslateX(el) {
    const t = el.style.transform || '';
    const m = t.match(/translateX\((-?[\d.]+)px\)/);
    return m ? parseFloat(m[1]) : 0;
  }

  function findSwipeContent(target) {
    const row = target.closest('.item-card, .history-item');
    if (!row) return null;
    return row.classList.contains('item-card')
      ? row.querySelector('.item-card__content')
      : row.querySelector('.history-item__content');
  }

  function handleTouchStart(e) {
    const content = findSwipeContent(e.target);
    if (!content) return;

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchCurrentX = touchStartX;
    startTranslateX = getTranslateX(content);
    swipingEl = content;
    swipeDirection = null;
    content.style.transition = 'none';
  }

  function handleTouchMove(e) {
    if (!swipingEl) return;

    touchCurrentX = e.touches[0].clientX;
    const diffX = touchCurrentX - touchStartX;
    const diffY = e.touches[0].clientY - touchStartY;

    // Determine direction lock
    if (swipeDirection === null && (Math.abs(diffX) > 8 || Math.abs(diffY) > 8)) {
      if (Math.abs(diffY) > Math.abs(diffX)) {
        // Vertical scroll - restore and cancel
        swipingEl.style.transform = `translateX(${startTranslateX}px)`;
        swipingEl = null;
        return;
      }
      swipeDirection = 'horizontal';
    }

    if (swipeDirection === 'horizontal') {
      const targetX = Math.max(-160, Math.min(0, startTranslateX + diffX));
      swipingEl.style.transform = `translateX(${targetX}px)`;
      e.preventDefault();
    }
  }

  function handleTouchEnd() {
    if (!swipingEl) return;

    swipingEl.style.transition = 'transform 0.2s ease';
    const finalX = getTranslateX(swipingEl);

    if (finalX < -40) {
      swipingEl.style.transform = 'translateX(-80px)';
    } else {
      swipingEl.style.transform = 'translateX(0)';
    }

    swipingEl = null;
    swipeDirection = null;
  }

  function resetSwipes() {
    document.querySelectorAll('.item-card__content, .history-item__content').forEach(el => {
      el.style.transition = 'transform 0.2s ease';
      el.style.transform = 'translateX(0)';
    });
  }

  // === Complete (check) flow with fade + undo ===
  function handleCompleteItem(id) {
    const card = document.querySelector(`.item-card[data-id="${id}"]`);
    if (!card || card.classList.contains('item-card--removing')) return;

    const checkEl = card.querySelector('.item-card__check');
    if (checkEl) checkEl.classList.add('item-card__check--checked');
    card.classList.add('item-card--removing');

    setTimeout(() => {
      const result = Store.items.complete(id);
      queueSync({ type: 'purchase', localId: id });
      renderList();
      if (!result) return;

      const { item, historyId, autoFavorited } = result;
      const msg = autoFavorited
        ? `「${item.name}」を購入済みに ⭐お気に入り登録`
        : `「${item.name}」を購入済みに`;

      showToast(msg, {
        duration: 3000,
        action: {
          label: '元に戻す',
          callback: () => {
            Store.items.restore(item, historyId);
            queueSync({ type: 'update', localId: item.id, payload: { purchased: false } });
            renderList();
          }
        }
      });
    }, 400);
  }

  // === Event Handling ===
  function handleItemListClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === 'check') {
      handleCompleteItem(id);
    } else if (action === 'edit') {
      const item = Store.items.getAll().find(i => i.id === id);
      if (item) openModal('edit', item);
    } else if (action === 'delete') {
      Store.items.remove(id);
      queueSync({ type: 'delete', localId: id });
      showToast('削除しました');
      renderList();
    }
  }

  function handleHistoryClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    if (target.dataset.action === 'delete-hist') {
      Store.history.removeById(target.dataset.id);
      renderHistory();
      const headerAction = document.getElementById('headerAction');
      if (currentView === 'history' && Store.history.getAll().length === 0) {
        headerAction.style.display = 'none';
      }
      showToast('履歴から削除');
      return;
    }

    if (target.dataset.action === 'readd') {
      Store.items.add({
        name: target.dataset.name,
        category: target.dataset.category,
        quantity: parseInt(target.dataset.quantity) || 1,
        unit: target.dataset.unit,
        memo: target.dataset.memo,
        price: target.dataset.price ? parseInt(target.dataset.price) : ''
      });
      showToast(`${target.dataset.name} をリストに追加`);
    }
  }

  function handleFavoritesClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === 'quickadd') {
      const fav = Store.favorites.getAll().find(f => f.id === id);
      if (fav) {
        Store.items.add({
          name: fav.name,
          category: fav.category,
          quantity: fav.quantity,
          unit: fav.unit,
          memo: fav.memo
        });
        Store.favorites.incrementUsage(id);
        showToast(`${fav.name} をリストに追加`);
      }
    } else if (action === 'removefav') {
      Store.favorites.remove(id);
      showToast('お気に入りから削除');
      renderFavorites();
    }
  }

  function handleHeaderAction() {
    if (currentView === 'history') {
      showConfirm('購入履歴をすべて削除しますか？', '削除', () => {
        Store.history.clear();
        renderHistory();
        document.getElementById('headerAction').style.display = 'none';
        showToast('履歴を削除しました');
      });
    }
  }

  // === Init ===
  // === モード切替（やること / 買い物）===
  let currentMode = 'todo';

  function switchMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('mode-btn--active', b.dataset.mode === mode));

    const isShop = mode === 'shop';
    // 買い物モードのときだけ、買い物用の画面と操作を見せる
    document.getElementById('viewTodo').classList.toggle('view--active', !isShop);
    document.getElementById('bottomNav').style.display = isShop ? '' : 'none';
    document.getElementById('fabAdd').style.display = isShop ? '' : 'none';
    ['viewList', 'viewHistory', 'viewFavorites'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !isShop) el.classList.remove('view--active');
    });
    const ttl = document.querySelector('.header__title');
    if (ttl) ttl.textContent = isShop ? '🛒 買い物リスト' : '✅ やること';
    if (isShop) switchView('list');
    else if (window.Todo) { Todo.render(); Todo.refresh(); }
    try { localStorage.setItem('sl_mode', mode); } catch {}
  }

  // === Notion同期 ===
  function queueSync(op) {
    if (!window.Sync || !Sync.isConfigured()) return;
    Sync.enqueue(op);
    // すぐ送る（失敗しても待ち行列に残るのでオフラインでも安全）
    Sync.flush().then(() => refreshFromNotion(false)).catch(() => {});
  }

  function setSyncStatus(state) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const map = { syncing: '同期中…', ok: '', error: 'オフライン表示中' };
    el.textContent = map[state] || '';
    el.className = 'sync-status' + (state === 'error' ? ' sync-status--error' : '');
  }

  async function refreshFromNotion(notifyOnError) {
    if (!window.Sync || !Sync.isConfigured()) return;
    try {
      setSyncStatus('syncing');
      const remote = await Sync.syncNow();
      if (remote) {
        Store.items.mergeFromNotion(remote, Sync.pendingLocalIds());
        renderList();
      }
      if (window.Todo) await Todo.refresh();
      setSyncStatus('ok');
    } catch (e) {
      setSyncStatus('error');
      if (notifyOnError) showToast('同期できませんでした（オフライン表示中）');
    }
  }

  function initSync() {
    if (!window.Sync || !Sync.isConfigured()) return;
    refreshFromNotion(false);
    // 画面に戻ったとき・通信が復活したとき・1分ごとに同期
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshFromNotion(false);
    });
    window.addEventListener('online', () => refreshFromNotion(false));
    setInterval(() => { if (!document.hidden) refreshFromNotion(false); }, 60000);
  }

  // === 同期設定画面 ===
  function openSyncSettings() {
    const conf = (window.Sync && Sync.getConf()) || { workerUrl: '', appKey: '' };
    document.getElementById('syncUrl').value = conf.workerUrl || '';
    document.getElementById('syncKey').value = conf.appKey || '';
    document.getElementById('syncMsg').textContent = '';
    document.getElementById('syncModal').classList.add('modal--active');
    document.getElementById('modalBackdrop').classList.add('modal-backdrop--active');
  }

  function closeSyncSettings() {
    document.getElementById('syncModal').classList.remove('modal--active');
    document.getElementById('modalBackdrop').classList.remove('modal-backdrop--active');
  }

  async function saveSyncSettings() {
    const workerUrl = document.getElementById('syncUrl').value.trim();
    const appKey = document.getElementById('syncKey').value.trim();
    const msg = document.getElementById('syncMsg');
    if (!workerUrl || !appKey) { msg.textContent = '両方入力してください'; return; }
    msg.textContent = '接続を確認中…';
    try {
      const count = await Sync.test(workerUrl, appKey);
      Sync.setConf({ workerUrl, appKey });
      msg.textContent = `つながりました！（${count}件）`;
      await refreshFromNotion(true);
      setTimeout(closeSyncSettings, 800);
    } catch (e) {
      msg.textContent = '失敗: ' + e.message;
    }
  }

  function init() {
    // Render unit options
    renderUnitOptions();

    // Initial render
    renderList();

    // モード切替
    document.getElementById('modeSwitch').addEventListener('click', e => {
      const b = e.target.closest('.mode-btn');
      if (b) switchMode(b.dataset.mode);
    });
    if (window.Todo) { Todo.load(); Todo.bind(); }
    let savedMode = 'todo';
    try { savedMode = localStorage.getItem('sl_mode') || 'todo'; } catch {}
    switchMode(savedMode);

    // Notion同期を開始
    initSync();

    // 同期設定
    const sb = document.getElementById('syncSettingsBtn');
    if (sb) sb.addEventListener('click', openSyncSettings);
    const sc = document.getElementById('syncCancel');
    if (sc) sc.addEventListener('click', closeSyncSettings);
    const ss = document.getElementById('syncSave');
    if (ss) ss.addEventListener('click', saveSyncSettings);

    // Bottom nav
    document.getElementById('bottomNav').addEventListener('click', e => {
      const tab = e.target.closest('.nav-tab');
      if (tab) switchView(tab.dataset.view);
    });

    // FAB
    document.getElementById('fabAdd').addEventListener('click', () => openModal('add'));

    // Header action
    document.getElementById('headerAction').addEventListener('click', handleHeaderAction);

    // Item list events
    document.getElementById('itemList').addEventListener('click', handleItemListClick);

    // History events
    document.getElementById('historyList').addEventListener('click', handleHistoryClick);

    // Favorites events
    document.getElementById('favoritesList').addEventListener('click', handleFavoritesClick);

    // Swipe on item list and history list
    [document.getElementById('itemList'), document.getElementById('historyList')].forEach(el => {
      el.addEventListener('touchstart', handleTouchStart, { passive: true });
      el.addEventListener('touchmove', handleTouchMove, { passive: false });
      el.addEventListener('touchend', handleTouchEnd, { passive: true });
    });

    // Modal
    document.getElementById('modalBackdrop').addEventListener('click', closeModal);
    document.getElementById('btnCancel').addEventListener('click', closeModal);
    document.getElementById('itemForm').addEventListener('submit', e => {
      e.preventDefault();
      handleModalSubmit();
    });

    // URL fetch button
    document.getElementById('btnFetchUrl').addEventListener('click', () => {
      const url = document.getElementById('inputUrl').value.trim();
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        fetchUrlInfo(url);
      }
    });

    // Category chips delegation
    document.getElementById('categoryChips').addEventListener('click', e => {
      const chip = e.target.closest('.category-chip');
      if (chip) {
        selectedCategory = chip.dataset.category;
        categoryTouched = true;
        renderCategoryChips();
      }
    });

    // Auto-suggest on name input (debounced)
    document.getElementById('inputName').addEventListener('input', () => {
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(applySuggestion, 250);
    });

    // Manual unit change disables unit auto-suggest for this modal session
    document.getElementById('inputUnit').addEventListener('change', () => {
      unitTouched = true;
    });

    // Quantity buttons
    document.getElementById('qtyMinus').addEventListener('click', () => {
      const input = document.getElementById('inputQuantity');
      input.value = Math.max(1, parseInt(input.value) - 1);
    });
    document.getElementById('qtyPlus').addEventListener('click', () => {
      const input = document.getElementById('inputQuantity');
      input.value = Math.min(99, parseInt(input.value) + 1);
    });

    // Confirm dialog
    document.getElementById('confirmCancel').addEventListener('click', hideConfirm);
    document.getElementById('confirmBackdrop').addEventListener('click', hideConfirm);
    document.getElementById('confirmOk').addEventListener('click', () => {
      if (confirmCallback) confirmCallback();
      hideConfirm();
    });

    // Reset swipes on scroll
    document.addEventListener('scroll', resetSwipes, { passive: true });

    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { switchView, showToast };
})();
