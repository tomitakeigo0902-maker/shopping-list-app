/**
 * 🛒 買い物データベースをNotionに作成する（初回1回だけ実行）
 * 使い方:
 *   node create-notion-db.js <NOTIONトークン> <親ページID or URL>
 */
const NOTION = 'https://api.notion.com/v1';
const VER = '2022-06-28';

const CATEGORIES = [
  ['食品', 'orange'], ['野菜・果物', 'green'], ['肉・魚', 'red'],
  ['飲料', 'blue'], ['乳製品', 'yellow'], ['パン・麺', 'brown'],
  ['調味料', 'purple'], ['冷凍食品', 'blue'], ['日用品', 'gray'],
  ['欲しいもの', 'pink'], ['その他', 'default'],
];
const UNITS = ['個', '本', 'パック', '袋', '枚', '缶', '箱', 'g', 'kg', 'ml', 'L'];

const [, , token, parentRaw] = process.argv;
if (!token || !parentRaw) {
  console.error('使い方: node create-notion-db.js <トークン> <親ページURLまたはID>');
  process.exit(1);
}
// URLからページIDを取り出す（末尾32桁の16進）
const m = String(parentRaw).replace(/-/g, '').match(/([0-9a-f]{32})(?!.*[0-9a-f]{32})/i);
if (!m) { console.error('親ページIDを読み取れませんでした:', parentRaw); process.exit(1); }
const parentId = m[1];

(async () => {
  const res = await fetch(`${NOTION}/databases`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VER, 'content-type': 'application/json' },
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentId },
      icon: { type: 'emoji', emoji: '🛒' },
      title: [{ type: 'text', text: { content: '🛒 買い物' } }],
      properties: {
        '商品名': { title: {} },
        'カテゴリ': { select: { options: CATEGORIES.map(([name, color]) => ({ name, color })) } },
        '数量': { number: {} },
        '単位': { select: { options: UNITS.map((name) => ({ name })) } },
        'メモ': { rich_text: {} },
        '価格': { number: { format: 'yen' } },
        'URL': { url: {} },
        '購入済み': { checkbox: {} },
      },
    }),
  });
  const d = await res.json();
  if (!res.ok) { console.error('作成失敗:', d.message || res.status); process.exit(1); }
  console.log('作成しました！');
  console.log('DATABASE_ID =', d.id);
  console.log('URL =', d.url);
})();
