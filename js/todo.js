/**
 * todo.js - やること（Notion 📋 TODO）の画面
 * PCウィジェットと同じ仕様:
 *  - チェックは 未着手 → 進行中 → 完了 の3段階（完了には進行中を経由）
 *  - 並びは 進行中を最上段 → 期限が早い順 → 重要度が高い順、完了は最下部
 *  - オフラインでも直前の内容を表示し、操作は待ち行列に入れて後で送信
 */
'use strict';

const Todo = (() => {
  const KEY_CACHE = 'sl_todos_cache';
  const NEXT_STATUS = { 未着手: '進行中', 進行中: '完了', 完了: '未着手' };
  const PRI = { 高: 0, 通常: 1, 低: 2 };
  const ST = { 進行中: 0, 未着手: 1, 完了: 2 };

  let todos = [];
  let filter = 'active'; // active | all | done
  const openMemo = new Set();

  function _read(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
  function _write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

  function load() { todos = _read(KEY_CACHE, []); return todos; }
  function save() { _write(KEY_CACHE, todos); }

  async function refresh() {
    if (!window.Sync || !Sync.isConfigured()) return;
    await Sync.flush().catch(() => {});
    todos = await Sync.pullTodos();
    save();
    render();
  }

  function sorted() {
    const list = todos.filter(t => {
      if (filter === 'active') return !t.done;
      if (filter === 'done') return t.done;
      return true;
    });
    return list.sort((a, b) => {
      const as = ST[a.status] ?? 1, bs = ST[b.status] ?? 1;
      if (as !== bs) return as - bs;
      if (a.done && b.done) return (b.lastEdited || '').localeCompare(a.lastEdited || '');
      const ad = a.due ? Date.parse(a.due) : Infinity;
      const bd = b.due ? Date.parse(b.due) : Infinity;
      if (ad !== bd) return ad - bd;
      const ap = PRI[a.priority] ?? 3, bp = PRI[b.priority] ?? 3;
      if (ap !== bp) return ap - bp;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function dueLabel(due) {
    const d = new Date(due);
    const hasTime = String(due).includes('T');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdue = hasTime ? d.getTime() < Date.now() : d < today;
    const hm = hasTime ? ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return { text: `📅 ${d.getMonth() + 1}/${d.getDate()}${hm}`, overdue };
  }

  function render() {
    const host = document.getElementById('todoList');
    const empty = document.getElementById('todoEmpty');
    if (!host) return;
    const list = sorted();

    document.querySelectorAll('.todo-filter').forEach(b =>
      b.classList.toggle('todo-filter--active', b.dataset.filter === filter));

    const remain = todos.filter(t => !t.done).length;
    const badge = document.getElementById('todoCount');
    if (badge) badge.textContent = remain ? `未完了 ${remain}` : '';

    if (!list.length) { host.innerHTML = ''; if (empty) empty.style.display = 'flex'; return; }
    if (empty) empty.style.display = 'none';

    host.innerHTML = list.map(t => {
      const doing = t.status === '進行中';
      const mark = t.done ? '✓' : doing ? '▶' : '';
      const tags = [];
      if (doing) tags.push('<span class="todo-tag todo-tag--doing">進行中</span>');
      if (t.category) tags.push(`<span class="todo-tag">${esc(t.category)}</span>`);
      if (t.priority && t.priority !== '通常')
        tags.push(`<span class="todo-tag todo-tag--pri-${esc(t.priority)}">${esc(t.priority)}</span>`);
      if (t.due) { const d = dueLabel(t.due); tags.push(`<span class="todo-tag${d.overdue ? ' todo-tag--over' : ''}">${esc(d.text)}</span>`); }
      if (t.memo) tags.push(`<span class="todo-tag todo-tag--memo" data-action="memo" data-id="${t.id}">📝</span>`);

      const memoHtml = t.memo && openMemo.has(t.id)
        ? `<div class="todo-memo">${esc(t.memo)}</div>` : '';

      return `<div class="todo-card${t.done ? ' todo-card--done' : ''}${doing ? ' todo-card--doing' : ''}" data-id="${t.id}">
        <div class="todo-card__row">
          <button class="todo-check${t.done ? ' todo-check--done' : ''}${doing ? ' todo-check--doing' : ''}"
                  data-action="cycle" data-id="${t.id}" aria-label="状態を変える">${mark}</button>
          <div class="todo-card__body">
            <div class="todo-card__title">${esc(t.title)}</div>
            ${tags.length ? `<div class="todo-card__tags">${tags.join('')}</div>` : ''}
          </div>
        </div>
        ${memoHtml}
      </div>`;
    }).join('');
  }

  // 未着手→進行中→完了 と1段階進める
  async function cycle(id) {
    const t = todos.find(x => x.id === id);
    if (!t) return;
    const prev = { status: t.status, done: t.done };
    const next = NEXT_STATUS[t.status] || '進行中';
    t.status = next;
    t.done = next === '完了';
    save();
    render();
    try {
      if (window.Sync && Sync.isConfigured()) {
        Sync.enqueue({ type: 'todo-update', id, payload: { status: next } });
        await Sync.flush();
      }
    } catch {
      Object.assign(t, prev); save(); render();
    }
  }

  function toggleMemo(id) {
    openMemo.has(id) ? openMemo.delete(id) : openMemo.add(id);
    render();
  }

  function bind() {
    const host = document.getElementById('todoList');
    if (host) {
      host.addEventListener('click', e => {
        const el = e.target.closest('[data-action]');
        if (!el) return;
        if (el.dataset.action === 'cycle') cycle(el.dataset.id);
        else if (el.dataset.action === 'memo') toggleMemo(el.dataset.id);
      });
    }
    document.querySelectorAll('.todo-filter').forEach(b =>
      b.addEventListener('click', () => { filter = b.dataset.filter; render(); }));
  }

  return { load, render, refresh, bind, get count() { return todos.filter(t => !t.done).length; } };
})();

// 他のスクリプトから window.Todo で参照できるようにする
window.Todo = Todo;
