// app.js - Main Application Logic
'use strict';

const App = (() => {
  let currentView = 'list';
  let editingItemId = null;
  let selectedCategory = '食品';
  let confirmCallback = null;
  let toastTimer = null;

  // Touch swipe state
  let touchStartX = 0;
  let touchStartY = 0;
  let touchCurrentX = 0;
  let swipingEl = null;
  let swipeDirection = null; // 'left' | 'right' | null

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
  function showToast(message, duration = 2000) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('toast--show'), duration);
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
      headerAction.style.display = Store.items.hasChecked() ? 'flex' : 'none';
      headerAction.setAttribute('aria-label', '完了済みを削除');
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

    // Separate unchecked and checked
    const unchecked = items.filter(i => !i.checked);
    const checked = items.filter(i => i.checked);

    let html = '';

    // Render unchecked items grouped by category
    const groups = groupByCategory(unchecked);
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

    // Render checked items at the bottom
    if (checked.length > 0) {
      html += `<div class="category-group">
        <div class="category-group__header">
          <span class="category-group__dot" style="background:var(--color-checked)"></span>
          <span>✅ 完了済み (${checked.length})</span>
        </div>`;
      checked.forEach(item => {
        const catInfo = Store.getCategoryInfo(item.category);
        html += renderItemCard(item, catInfo);
      });
      html += '</div>';
    }

    container.innerHTML = html;

    // Update header action visibility
    const headerAction = document.getElementById('headerAction');
    if (currentView === 'list') {
      headerAction.style.display = Store.items.hasChecked() ? 'flex' : 'none';
    }
  }

  function renderItemCard(item, catInfo) {
    const checkedClass = item.checked ? ' item-card--checked' : '';
    const checkClass = item.checked ? ' item-card__check--checked' : '';
    const qtyText = item.quantity > 1 || item.unit !== '個' ? `${item.quantity}${item.unit}` : '';
    const memoText = item.memo ? `📝 ${escapeHtml(item.memo)}` : '';
    const metaParts = [qtyText, memoText].filter(Boolean).join(' ');
    const priceHtml = item.price ? `<span class="item-card__price">¥${Number(item.price).toLocaleString()}</span>` : '';

    return `<div class="item-card${checkedClass}" data-id="${item.id}">
      <div class="item-card__actions">
        <div class="item-card__action-fav" data-action="fav" data-id="${item.id}">⭐</div>
        <div class="item-card__action-delete" data-action="delete" data-id="${item.id}">削除</div>
      </div>
      <div class="item-card__content" style="border-left-color:${catInfo.color}">
        <div class="item-card__check${checkClass}" data-action="check" data-id="${item.id}"></div>
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
        html += `<div class="history-item" data-action="readd" data-name="${escapeHtml(item.itemName)}" data-category="${escapeHtml(item.category)}" data-quantity="${item.quantity}" data-unit="${escapeHtml(item.unit)}" data-memo="${escapeHtml(item.memo || '')}" style="border-left-color:${catInfo.color}">
          <div class="history-item__info">
            <div class="history-item__name">${catInfo.icon} ${escapeHtml(item.itemName)}${qty}</div>
            <div class="history-item__meta">${formatTime(item.checkedAt)}${item.memo ? ' · ' + escapeHtml(item.memo) : ''}</div>
          </div>
          <div class="history-item__add">＋</div>
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
  async function fetchUrlInfo(url) {
    const btn = document.getElementById('btnFetchUrl');
    const status = document.getElementById('urlStatus');
    const btnText = btn.querySelector('.btn-url-fetch__text');
    const btnLoading = btn.querySelector('.btn-url-fetch__loading');

    btn.classList.add('btn-url-fetch--loading');
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    status.textContent = '読み取り中...';
    status.className = 'url-status';

    try {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url);
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error('取得失敗');
      const html = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract title: og:title > title tag
      const ogTitle = doc.querySelector('meta[property="og:title"]');
      const title = ogTitle ? ogTitle.getAttribute('content') : doc.title || '';

      // Extract price from common patterns
      let price = '';
      const pricePatterns = [
        // JSON-LD
        () => {
          const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
          for (const s of scripts) {
            try {
              const json = JSON.parse(s.textContent);
              const findPrice = (obj) => {
                if (!obj || typeof obj !== 'object') return null;
                if (obj.price) return String(obj.price).replace(/[^0-9]/g, '');
                if (obj.lowPrice) return String(obj.lowPrice).replace(/[^0-9]/g, '');
                if (obj.offers) return findPrice(obj.offers);
                if (Array.isArray(obj)) {
                  for (const item of obj) { const r = findPrice(item); if (r) return r; }
                }
                return null;
              };
              const p = findPrice(json);
              if (p) return p;
            } catch {}
          }
          return null;
        },
        // og:price meta tags
        () => {
          const meta = doc.querySelector('meta[property="product:price:amount"], meta[property="og:price:amount"]');
          return meta ? meta.getAttribute('content').replace(/[^0-9]/g, '') : null;
        },
        // Common price patterns in HTML text
        () => {
          const text = html;
          // Match ¥1,234 or ￥1,234 or 1,234円
          const m = text.match(/[¥￥]\s*([\d,]+)/);
          if (m) return m[1].replace(/,/g, '');
          const m2 = text.match(/([\d,]+)\s*円/);
          if (m2) return m2[1].replace(/,/g, '');
          return null;
        }
      ];

      for (const fn of pricePatterns) {
        const result = fn();
        if (result && result.length > 0 && result.length < 10) {
          price = result;
          break;
        }
      }

      // Apply results
      if (title) {
        // Clean up title (remove site name suffixes like " | Amazon" etc.)
        let cleanTitle = title.replace(/\s*[\|–\-]\s*[^|–\-]*$/, '').trim();
        if (cleanTitle.length > 60) cleanTitle = cleanTitle.substring(0, 60);
        document.getElementById('inputName').value = cleanTitle;
      }
      if (price) {
        document.getElementById('inputPrice').value = price;
      }

      const parts = [];
      if (title) parts.push('商品名を取得');
      if (price) parts.push('価格を取得');

      if (parts.length > 0) {
        status.textContent = '✓ ' + parts.join('・');
        status.className = 'url-status url-status--success';
      } else {
        status.textContent = '情報を取得できませんでした';
        status.className = 'url-status url-status--error';
      }
    } catch (e) {
      status.textContent = '読み取りに失敗しました';
      status.className = 'url-status url-status--error';
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
      showToast('更新しました');
    } else {
      Store.items.add(data);
      showToast(`${name} を追加しました`);
    }

    closeModal();
    renderList();
  }

  // === Swipe Handling ===
  function handleTouchStart(e) {
    const card = e.target.closest('.item-card');
    if (!card) return;

    const content = card.querySelector('.item-card__content');
    if (!content) return;

    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchCurrentX = touchStartX;
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
        // Vertical scroll - cancel swipe
        swipingEl = null;
        return;
      }
      swipeDirection = diffX < 0 ? 'left' : 'right';
    }

    if (swipeDirection === 'left') {
      const tx = Math.max(-160, Math.min(0, diffX));
      swipingEl.style.transform = `translateX(${tx}px)`;
      e.preventDefault();
    } else if (swipeDirection === 'right') {
      const tx = Math.max(0, Math.min(160, diffX));
      swipingEl.style.transform = `translateX(${tx}px)`;
      e.preventDefault();
    }
  }

  function handleTouchEnd() {
    if (!swipingEl) return;

    const diffX = touchCurrentX - touchStartX;
    swipingEl.style.transition = 'transform 0.2s ease';

    if (swipeDirection === 'left' && diffX < -60) {
      swipingEl.style.transform = 'translateX(-80px)';
    } else if (swipeDirection === 'right' && diffX > 60) {
      swipingEl.style.transform = 'translateX(80px)';
    } else {
      swipingEl.style.transform = 'translateX(0)';
    }

    swipingEl = null;
    swipeDirection = null;
  }

  function resetSwipes() {
    document.querySelectorAll('.item-card__content').forEach(el => {
      el.style.transition = 'transform 0.2s ease';
      el.style.transform = 'translateX(0)';
    });
  }

  // === Event Handling ===
  function handleItemListClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === 'check') {
      Store.items.check(id);
      renderList();
    } else if (action === 'edit') {
      const item = Store.items.getAll().find(i => i.id === id);
      if (item) openModal('edit', item);
    } else if (action === 'delete') {
      Store.items.remove(id);
      showToast('削除しました');
      renderList();
    } else if (action === 'fav') {
      const item = Store.items.getAll().find(i => i.id === id);
      if (item) {
        Store.favorites.add({
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          memo: item.memo
        });
        showToast(`${item.name} をお気に入りに追加`);
        resetSwipes();
      }
    }
  }

  function handleHistoryClick(e) {
    const target = e.target.closest('[data-action="readd"]');
    if (!target) return;

    Store.items.add({
      name: target.dataset.name,
      category: target.dataset.category,
      quantity: parseInt(target.dataset.quantity) || 1,
      unit: target.dataset.unit,
      memo: target.dataset.memo
    });
    showToast(`${target.dataset.name} をリストに追加`);
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
    if (currentView === 'list') {
      showConfirm('完了済みの商品をすべて削除しますか？', '削除', () => {
        Store.items.clearChecked();
        renderList();
        showToast('完了済みを削除しました');
      });
    } else if (currentView === 'history') {
      showConfirm('購入履歴をすべて削除しますか？', '削除', () => {
        Store.history.clear();
        renderHistory();
        document.getElementById('headerAction').style.display = 'none';
        showToast('履歴を削除しました');
      });
    }
  }

  // === Init ===
  function init() {
    // Render unit options
    renderUnitOptions();

    // Initial render
    renderList();

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

    // Swipe on item list
    const itemList = document.getElementById('itemList');
    itemList.addEventListener('touchstart', handleTouchStart, { passive: true });
    itemList.addEventListener('touchmove', handleTouchMove, { passive: false });
    itemList.addEventListener('touchend', handleTouchEnd, { passive: true });

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
        renderCategoryChips();
      }
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
