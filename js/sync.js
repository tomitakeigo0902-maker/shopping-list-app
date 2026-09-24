/**
 * sync.js - Notion同期レイヤー（中継Worker経由）
 *
 * 設計方針:
 *  - localStorage が常に「作業用コピー」。画面は必ずここから即描画する（オフラインでも動く）
 *  - 通信できたときだけ Notion と同期する
 *  - 圏外での変更は待ち行列に貯めて、オンラインになったら送る（スーパーは電波が悪いため）
 */
'use strict';

const Sync = (() => {
  const KEY_CONF = 'sl_sync_conf';   // { workerUrl, appKey }
  const KEY_QUEUE = 'sl_sync_queue'; // 未送信の操作
  const KEY_LINK = 'sl_sync_link';   // ローカルitem.id -> NotionページID

  function _read(k, fb) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
  function _write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

  function getConf() { return _read(KEY_CONF, null); }
  function setConf(conf) { _write(KEY_CONF, conf); }
  function isConfigured() { const c = getConf(); return !!(c && c.workerUrl && c.appKey); }

  function linkMap() { return _read(KEY_LINK, {}); }
  function setLink(localId, notionId) { const m = linkMap(); m[localId] = notionId; _write(KEY_LINK, m); }
  function notionIdOf(localId) {
    const m = linkMap()[localId];
    if (m) return m;
    // Notion由来の商品はページIDをそのままローカルidに使っている
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(localId)) return localId;
    return null;
  }
  // まだ送信できていないローカル追加分のid（同期時に消さないため）
  function pendingLocalIds() {
    return queue().filter(o => o.type === 'create' && o.localId).map(o => o.localId);
  }

  async function api(method, path, body) {
    const c = getConf();
    if (!c) throw new Error('同期設定がありません');
    const res = await fetch(c.workerUrl.replace(/\/$/, '') + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-app-key': c.appKey },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // 接続テスト（設定画面で使用）
  async function test(workerUrl, appKey) {
    const res = await fetch(workerUrl.replace(/\/$/, '') + '/items', {
      headers: { 'x-app-key': appKey },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 401) throw new Error('合言葉(APP_KEY)が違います');
    if (!res.ok) throw new Error(`つながりません (HTTP ${res.status})`);
    const d = await res.json();
    return (d.items || []).length;
  }

  // --- 待ち行列（オフライン対応） ---
  function queue() { return _read(KEY_QUEUE, []); }
  function enqueue(op) { const q = queue(); q.push({ ...op, at: Date.now() }); _write(KEY_QUEUE, q); }

  async function flush() {
    const q = queue();
    if (!q.length) return 0;
    const rest = [];
    let done = 0;
    for (const op of q) {
      try {
        await applyOp(op);
        done++;
      } catch {
        rest.push(op); // 失敗したものは残して次回再送
      }
    }
    _write(KEY_QUEUE, rest);
    return done;
  }

  async function applyOp(op) {
    if (op.type === 'create') {
      const d = await api('POST', '/items', op.payload);
      if (op.localId && d.item) setLink(op.localId, d.item.id);
    } else if (op.type === 'purchase') {
      const nid = op.notionId || notionIdOf(op.localId);
      if (nid) await api('PATCH', '/items/' + nid, { purchased: true });
    } else if (op.type === 'update') {
      const nid = op.notionId || notionIdOf(op.localId);
      if (nid) await api('PATCH', '/items/' + nid, op.payload);
    } else if (op.type === 'todo-update') {
      await api('PATCH', '/todos/' + op.id, op.payload);
    } else if (op.type === 'todo-create') {
      await api('POST', '/todos', op.payload);
    } else if (op.type === 'todo-delete') {
      await api('DELETE', '/todos/' + op.id);
    } else if (op.type === 'delete') {
      const nid = op.notionId || notionIdOf(op.localId);
      if (nid) await api('DELETE', '/items/' + nid);
    }
  }

  // --- 同期本体 ---
  // Notionの未購入リストを取得し、ローカルへ反映する。
  // Notion由来の商品は notionId を持ち、ローカルだけの商品はそのまま残す。
  async function pull() {
    const d = await api('GET', '/items');
    return d.items || [];
  }

  // 画面側から呼ぶ入口: 待ち行列を送ってから最新を取得
  async function syncNow() {
    if (!isConfigured()) return null;
    await flush();
    return await pull();
  }

  // ===== 価格記録 =====
  async function pullPrices() {
    const d = await api('GET', '/prices');
    return d.prices || [];
  }

  // ===== TODO =====
  async function pullTodos() {
    const d = await api('GET', '/todos');
    return d.todos || [];
  }
  async function updateTodo(id, patch) {
    const d = await api('PATCH', '/todos/' + id, patch);
    return d.todo;
  }
  async function createTodo(payload) {
    const d = await api('POST', '/todos', payload);
    return d.todo;
  }
  async function deleteTodo(id) {
    return api('DELETE', '/todos/' + id);
  }

  return {
    isConfigured, getConf, setConf, test,
    pullTodos, updateTodo, createTodo, deleteTodo, pullPrices,
    enqueue, flush, pull, syncNow, pendingLocalIds,
    setLink, notionIdOf,
  };
})();

// 他のスクリプトから window.Sync で参照できるようにする
window.Sync = Sync;
