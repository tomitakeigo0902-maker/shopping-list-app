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
const P = {
  name: '商品名',
  category: 'カテゴリ',
  quantity: '数量',
  unit: '単位',
  memo: 'メモ',
  price: '価格',
  url: 'URL',
  purchased: '購入済み',
};

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
      filter: { property: P.purchased, checkbox: { equals: false } },
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
    purchased: !!(p[P.purchased] && p[P.purchased].checkbox),
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
  if (b.purchased !== undefined) props[P.purchased] = { checkbox: !!b.purchased };
  return props;
}

async function createItem(env, b) {
  const page = await notion(env, 'POST', '/pages', {
    parent: { database_id: env.DATABASE_ID },
    properties: buildProps({ purchased: false, ...b }),
  });
  return parsePage(page);
}

async function updateItem(env, id, b) {
  const page = await notion(env, 'PATCH', `/pages/${id}`, { properties: buildProps(b) });
  return parsePage(page);
}
