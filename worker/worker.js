/**
 * 買い物リスト同期用の中継サーバー（Cloudflare Worker）
 *
 * なぜ必要か: NotionのAPIはブラウザから直接呼べない（CORS非対応）ため、
 * スマホのPWAとNotionの間をこのWorkerが中継する。
 * Notionのトークンはこのサーバー側にだけ置き、スマホには渡さない。
 *
 * 必要なシークレット（wrangler secret put で設定）:
 *   NOTION_TOKEN  … 買い物DBだけにアクセスできるNotionコネクトのトークン
 *   APP_KEY       … このAPIを使うための合言葉（PWAに設定する）
 * 変数（wrangler.toml）:
 *   DATABASE_ID   … 🛒 買い物 データベースのID
 *   ALLOW_ORIGIN  … PWAのオリジン（例: https://tomitakeigo0902-maker.github.io）
 */

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Notion プロパティ名（create-notion-db.js と一致させること）
// 買い物の行で使うプロパティ名（📋 TODO と同じDB内。カテゴリ=買い物 で区別する）
const P = {
  name: 'タスク',
  category: '買い物カテゴリ',
  quantity: '数量',
  unit: '単位',
  memo: 'メモ',
  price: '価格',
  url: 'URL',
};
const SHOPPING_TAG = '買い物'; // カテゴリ列がこの値の行＝買い物

// 📋 TODO DBのプロパティ名
const T = {
  title: 'タスク',
  status: 'ステータス',
  category: 'カテゴリ',
  priority: '優先度',
  due: '期限',
  memo: 'メモ',
};
const STATUS = { todo: '未着手', doing: '進行中', done: '完了' };

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);

    // ブラウザの事前確認（プリフライト）に応答
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // 合言葉チェック（無関係な第三者に使わせない）
    const key = request.headers.get('x-app-key');
    if (!env.APP_KEY || key !== env.APP_KEY) {
      return json({ error: 'unauthorized' }, 401, cors);
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ["items"] or ["items", "<id>"]

    try {
      // --- TODO（📋 TODO データベース）---
      if (parts[0] === 'todos') {
        if (request.method === 'GET' && parts.length === 1) {
          return json({ todos: await listTodos(env) }, 200, cors);
        }
        if (request.method === 'POST' && parts.length === 1) {
          return json({ todo: await createTodo(env, await request.json()) }, 200, cors);
        }
        if (request.method === 'PATCH' && parts.length === 2) {
          return json({ todo: await updateTodo(env, parts[1], await request.json()) }, 200, cors);
        }
        if (request.method === 'DELETE' && parts.length === 2) {
          await notion(env, 'PATCH', `/pages/${parts[1]}`, { archived: true });
          return json({ ok: true }, 200, cors);
        }
        return json({ error: 'method not allowed' }, 405, cors);
      }

      // --- 買い物（🛒 買い物 データベース）---
      if (parts[0] !== 'items') return json({ error: 'not found' }, 404, cors);

      if (request.method === 'GET' && parts.length === 1) {
        return json({ items: await listItems(env) }, 200, cors);
      }
      if (request.method === 'POST' && parts.length === 1) {
        const body = await request.json();
        return json({ item: await createItem(env, body) }, 200, cors);
      }
      if (request.method === 'PATCH' && parts.length === 2) {
        const body = await request.json();
        return json({ item: await updateItem(env, parts[1], body) }, 200, cors);
      }
      if (request.method === 'DELETE' && parts.length === 2) {
        await notion(env, 'PATCH', `/pages/${parts[1]}`, { archived: true });
        return json({ ok: true }, 200, cors);
      }
      return json({ error: 'method not allowed' }, 405, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
  },
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,x-app-key',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });
}

async function notion(env, method, path, body) {
  const res = await fetch(NOTION_API + path, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Notion HTTP ${res.status}`);
  return data;
}

// 未購入の商品を取得（購入済みは返さない）
async function listItems(env) {
  let results = [];
  let cursor;
  do {
    const body = {
      page_size: 100,
      filter: {
        and: [
          { property: T.category, select: { equals: SHOPPING_TAG } },
          { property: T.status, select: { does_not_equal: STATUS.done } },
        ],
      },
    };
    if (cursor) body.start_cursor = cursor;
    const d = await notion(env, 'POST', `/databases/${env.DATABASE_ID}/query`, body);
    results = results.concat(d.results || []);
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return results.map(parsePage);
}

function parsePage(page) {
  const p = page.properties || {};
  const text = (arr) => (arr || []).map((t) => t.plain_text || (t.text && t.text.content) || '').join('');
  const sel = (k) => (p[k] && p[k].select ? p[k].select.name : null);
  return {
    id: page.id,
    name: text(p[P.name] && p[P.name].title) || '(無題)',
    category: sel(P.category) || 'その他',
    quantity: (p[P.quantity] && p[P.quantity].number) ?? 1,
    unit: sel(P.unit) || '個',
    memo: text(p[P.memo] && p[P.memo].rich_text),
    price: (p[P.price] && p[P.price].number) ?? '',
    url: (p[P.url] && p[P.url].url) || '',
    purchased: (p[T.status] && p[T.status].select ? p[T.status].select.name : '') === STATUS.done,
    createdAt: Date.parse(page.created_time) || Date.now(),
  };
}

function buildProps(b) {
  const props = {};
  if (b.name !== undefined) props[P.name] = { title: [{ text: { content: b.name } }] };
  if (b.category !== undefined) props[P.category] = b.category ? { select: { name: b.category } } : { select: null };
  if (b.quantity !== undefined) props[P.quantity] = { number: Number(b.quantity) || null };
  if (b.unit !== undefined) props[P.unit] = b.unit ? { select: { name: b.unit } } : { select: null };
  if (b.memo !== undefined) props[P.memo] = { rich_text: [{ text: { content: b.memo || '' } }] };
  if (b.price !== undefined) props[P.price] = { number: b.price === '' || b.price === null ? null : Number(b.price) };
  if (b.url !== undefined) props[P.url] = { url: b.url || null };
  if (b.purchased !== undefined) {
    props[T.status] = { select: { name: b.purchased ? STATUS.done : STATUS.todo } };
  }
  return props;
}

async function createItem(env, b) {
  const properties = buildProps({ purchased: false, ...b });
  properties[T.category] = { select: { name: SHOPPING_TAG } }; // 買い物として登録
  const page = await notion(env, 'POST', '/pages', {
    parent: { database_id: env.DATABASE_ID },
    properties,
  });
  return parsePage(page);
}

async function updateItem(env, id, b) {
  const page = await notion(env, 'PATCH', `/pages/${id}`, { properties: buildProps(b) });
  return parsePage(page);
}


// ===== TODO（📋 TODO データベース）=====

async function listTodos(env) {
  let results = [];
  let cursor;
  do {
    const body = {
      page_size: 100,
      filter: { property: T.category, select: { does_not_equal: SHOPPING_TAG } },
    };
    if (cursor) body.start_cursor = cursor;
    const d = await notion(env, 'POST', `/databases/${env.DATABASE_ID}/query`, body);
    results = results.concat(d.results || []);
    cursor = d.has_more ? d.next_cursor : null;
  } while (cursor);
  return results.map(parseTodo);
}

function parseTodo(page) {
  const p = page.properties || {};
  const text = (arr) => (arr || []).map((t) => t.plain_text || (t.text && t.text.content) || '').join('');
  const sel = (k) => (p[k] && p[k].select ? p[k].select.name : null);
  const status = sel(T.status) || STATUS.todo;
  return {
    id: page.id,
    title: text(p[T.title] && p[T.title].title) || '(無題)',
    status,
    done: status === STATUS.done,
    category: sel(T.category),
    priority: sel(T.priority),
    due: p[T.due] && p[T.due].date ? p[T.due].date.start : null,
    memo: text(p[T.memo] && p[T.memo].rich_text),
    createdAt: Date.parse(page.created_time) || Date.now(),
    lastEdited: page.last_edited_time,
  };
}

function buildTodoProps(b) {
  const props = {};
  if (b.title !== undefined) props[T.title] = { title: [{ text: { content: b.title } }] };
  if (b.status !== undefined) props[T.status] = { select: { name: b.status } };
  if (b.category !== undefined) props[T.category] = b.category ? { select: { name: b.category } } : { select: null };
  if (b.priority !== undefined) props[T.priority] = b.priority ? { select: { name: b.priority } } : { select: null };
  if (b.due !== undefined) props[T.due] = b.due ? { date: { start: b.due } } : { date: null };
  if (b.memo !== undefined) props[T.memo] = { rich_text: [{ text: { content: b.memo || '' } }] };
  return props;
}

async function createTodo(env, b) {
  const page = await notion(env, 'POST', '/pages', {
    parent: { database_id: env.DATABASE_ID },
    properties: buildTodoProps({ status: STATUS.todo, ...b }),
  });
  return parseTodo(page);
}

async function updateTodo(env, id, b) {
  const page = await notion(env, 'PATCH', `/pages/${id}`, { properties: buildTodoProps(b) });
  return parseTodo(page);
}
