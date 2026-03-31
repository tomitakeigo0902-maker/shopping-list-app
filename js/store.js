// store.js - localStorage Data Access Layer
'use strict';

const CATEGORIES = [
  { key: '食品',       color: '#FF8A65', icon: '🍚' },
  { key: '野菜・果物', color: '#66BB6A', icon: '🥬' },
  { key: '肉・魚',     color: '#EF5350', icon: '🥩' },
  { key: '飲料',       color: '#42A5F5', icon: '🥤' },
  { key: '乳製品',     color: '#FFF176', icon: '🧀' },
  { key: 'パン・麺',   color: '#D4A373', icon: '🍞' },
  { key: '調味料',     color: '#AB47BC', icon: '🧂' },
  { key: '冷凍食品',   color: '#4FC3F7', icon: '🧊' },
  { key: '日用品',     color: '#78909C', icon: '🧴' },
  { key: 'その他',     color: '#BDBDBD', icon: '📦' }
];

const UNITS = ['個', '本', 'パック', '袋', '枚', '缶', '箱', 'g', 'kg', 'ml', 'L', ''];

const Store = (() => {
  const KEYS = {
    items: 'sl_items',
    history: 'sl_history',
    favorites: 'sl_favorites',
    settings: 'sl_settings'
  };

  function _read(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch {
      return fallback;
    }
  }

  function _write(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        alert('ストレージの容量が不足しています。履歴を削除してください。');
      }
    }
  }

  function _generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  }

  function getCategoryInfo(key) {
    return CATEGORIES.find(c => c.key === key) || CATEGORIES[CATEGORIES.length - 1];
  }

  // Items
  const items = {
    getAll() {
      return _read(KEYS.items, []);
    },
    add(item) {
      const all = this.getAll();
      const newItem = {
        id: _generateId('item'),
        name: item.name,
        category: item.category || 'その他',
        quantity: item.quantity || 1,
        unit: item.unit || '個',
        memo: item.memo || '',
        checked: false,
        createdAt: Date.now(),
        sortOrder: all.length
      };
      all.push(newItem);
      _write(KEYS.items, all);
      return newItem;
    },
    update(id, patch) {
      const all = this.getAll();
      const idx = all.findIndex(i => i.id === id);
      if (idx === -1) return null;
      Object.assign(all[idx], patch);
      _write(KEYS.items, all);
      return all[idx];
    },
    remove(id) {
      const all = this.getAll().filter(i => i.id !== id);
      _write(KEYS.items, all);
    },
    check(id) {
      const all = this.getAll();
      const item = all.find(i => i.id === id);
      if (!item) return;
      item.checked = !item.checked;
      _write(KEYS.items, all);
      if (item.checked) {
        history.add({
          itemName: item.name,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          memo: item.memo
        });
        // Auto-favorite: if item appears 2+ times in history
        const histAll = history.getAll();
        const count = histAll.filter(h => h.itemName === item.name).length;
        if (count >= 2 && !favorites.getAll().find(f => f.name === item.name)) {
          favorites.add({
            name: item.name,
            category: item.category,
            quantity: item.quantity,
            unit: item.unit,
            memo: item.memo
          });
        }
      }
      return item;
    },
    clearChecked() {
      const all = this.getAll().filter(i => !i.checked);
      _write(KEYS.items, all);
    },
    hasChecked() {
      return this.getAll().some(i => i.checked);
    }
  };

  // History
  const history = {
    getAll() {
      return _read(KEYS.history, []);
    },
    add(entry) {
      const all = this.getAll();
      all.unshift({
        id: _generateId('hist'),
        itemName: entry.itemName,
        category: entry.category,
        quantity: entry.quantity,
        unit: entry.unit,
        memo: entry.memo,
        checkedAt: Date.now()
      });
      // Keep max 500 history entries
      if (all.length > 500) all.length = 500;
      _write(KEYS.history, all);
    },
    clear() {
      _write(KEYS.history, []);
    }
  };

  // Favorites
  const favorites = {
    getAll() {
      return _read(KEYS.favorites, []).sort((a, b) => b.usageCount - a.usageCount);
    },
    add(fav) {
      const all = _read(KEYS.favorites, []);
      const existing = all.find(f => f.name === fav.name);
      if (existing) {
        existing.usageCount++;
        _write(KEYS.favorites, all);
        return existing;
      }
      const newFav = {
        id: _generateId('fav'),
        name: fav.name,
        category: fav.category || 'その他',
        quantity: fav.quantity || 1,
        unit: fav.unit || '個',
        memo: fav.memo || '',
        usageCount: 1
      };
      all.push(newFav);
      _write(KEYS.favorites, all);
      return newFav;
    },
    remove(id) {
      const all = _read(KEYS.favorites, []).filter(f => f.id !== id);
      _write(KEYS.favorites, all);
    },
    update(id, patch) {
      const all = _read(KEYS.favorites, []);
      const idx = all.findIndex(f => f.id === id);
      if (idx === -1) return null;
      Object.assign(all[idx], patch);
      _write(KEYS.favorites, all);
      return all[idx];
    },
    incrementUsage(id) {
      const all = _read(KEYS.favorites, []);
      const fav = all.find(f => f.id === id);
      if (fav) {
        fav.usageCount++;
        _write(KEYS.favorites, all);
      }
    }
  };

  return { items, history, favorites, getCategoryInfo, CATEGORIES, UNITS };
})();
