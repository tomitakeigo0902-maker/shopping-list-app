/**
 * 💴 価格記録 データベースをNotionに作る（初回1回だけ）
 *
 * 使い方:
 *   node create-price-db.js <親ページのURLまたはID>
 *
 * トークンはPCウィジェットの設定（%APPDATA%/todo-widget/config.json）から読む。
 * 親ページは事前に「TODOウィジェット」コネクトと共有しておくこと。
 */
const fs = require('fs');
const path = require('path');

const NOTION = 'https://api.notion.com/v1';
const VER = '2022-06-28';

// 買い物リストと同じカテゴリ（アプリで同じ色・アイコンに揃えるため）
const CATEGORIES = [
  ['食品', 'orange'], ['野菜・果物', 'green'], ['肉・魚', 'red'], ['飲料', 'blue'],
  ['乳製品', 'yellow'], ['パン・麺', 'brown'], ['調味料', 'purple'], ['冷凍食品', 'blue'],
  ['お菓子', 'orange'], ['日用品', 'gray'], ['掃除・洗濯', 'green'], ['家具', 'brown'],
  ['家電', 'purple'], ['キッチン用品', 'orange'], ['衣類', 'purple'], ['医薬品・衛生', 'green'],
  ['文具', 'purple'], ['欲しいもの', 'pink'], ['その他', 'default'],
];

const parentRaw = process.argv[2];
if (!parentRaw) {
  console.error('使い方: node create-price-db.js <親ページのURLまたはID>');
  process.exit(1);
}
const m = String(parentRaw).replace(/-/g, '').match(/([0-9a-f]{32})(?!.*[0-9a-f]{32})/i);
if (!m) { console.error('ページIDを読み取れませんでした:', parentRaw); process.exit(1); }

const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'todo-widget', 'config.json'), 'utf8'));

(async () => {
  const res = await fetch(`${NOTION}/databases`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Notion-Version': VER, 'content-type': 'application/json' },
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: m[1] },
      icon: { type: 'emoji', emoji: '💴' },
      title: [{ type: 'text', text: { content: '💴 価格記録' } }],
      properties: {
        '商品名': { title: {} },
        '価格': { number: { format: 'yen' } },
        'スーパー': { select: { options: [] } },
        '日付': { date: {} },
        '特売': { checkbox: {} },
        '買い物カテゴリ': { select: { options: CATEGORIES.map(([name, color]) => ({ name, color })) } },
        'メモ': { rich_text: {} },
      },
    }),
  });
  const d = await res.json();
  if (!res.ok) { console.error('作成失敗:', d.message || res.status); process.exit(1); }
  console.log('PRICE_DATABASE_ID=' + d.id);
  console.log('URL=' + d.url);
  const ds = d.data_sources && d.data_sources[0];
  if (ds) console.log('DATA_SOURCE=collection://' + ds.id);
})();
