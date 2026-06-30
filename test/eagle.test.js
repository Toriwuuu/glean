'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const eagle = require('../lib/eagle');

// --- 可用性狀態 isReady / setReady ---
test('isReady: 預設為 true', () => {
  assert.strictEqual(eagle.isReady(), true);
});

test('setReady: false → isReady false；true → isReady true', () => {
  eagle.setReady(false);
  assert.strictEqual(eagle.isReady(), false);
  eagle.setReady(true);
  assert.strictEqual(eagle.isReady(), true);
});

// --- normalizeUrl：去除 utm / ref，去重對齊用 ---
test('normalizeUrl: 拿掉 utm_* 與 ref query', () => {
  assert.strictEqual(eagle.normalizeUrl('https://x.com/a?utm_source=z&ref=q'), 'https://x.com/a');
});

test('normalizeUrl: 保留非追蹤參數', () => {
  assert.strictEqual(eagle.normalizeUrl('https://x.com/a?b=1&utm_medium=x'), 'https://x.com/a?b=1');
});

test('normalizeUrl: null / 空字串原樣回傳，前後空白去除', () => {
  assert.strictEqual(eagle.normalizeUrl(null), null);
  assert.strictEqual(eagle.normalizeUrl(''), '');
  assert.strictEqual(eagle.normalizeUrl('  https://x.com/a  '), 'https://x.com/a');
});

// --- collectDescendantIds：抓「目標資料夾自己 + 所有子孫」---
test('collectDescendantIds: 命中目標後連同子孫一起收', () => {
  const tree = [
    { id: 'a', children: [{ id: 'b' }, { id: 'c', children: [{ id: 'd' }] }] },
    { id: 'e' },
  ];
  const acc = eagle.collectDescendantIds(tree, new Set(['c']), new Set(), false);
  assert.deepStrictEqual([...acc].sort(), ['c', 'd']);
});

// --- findFolderByName：巢狀遞迴找資料夾（支援 children / folders 兩種 key）---
test('findFolderByName: 找得到回節點、找不到回 null', () => {
  const tree = [{ name: 'X', children: [{ name: 'Y', folders: [{ name: 'Z' }] }] }];
  assert.strictEqual(eagle.findFolderByName(tree, 'Z').name, 'Z');
  assert.strictEqual(eagle.findFolderByName(tree, 'NOPE'), null);
  assert.strictEqual(eagle.findFolderByName('not-an-array', 'Z'), null);
});

// --- callEagle 降級模式：不連網、安全 no-op ---
test('callEagle 降級：item_add 回 { added: 0 }，不連網', async () => {
  eagle.setReady(false);
  const r = await eagle.callEagle('item_add', { items: [{ name: 'x' }] });
  assert.deepStrictEqual(r, { data: { added: 0 } });
  eagle.setReady(true);
});

test('callEagle 降級：其他動作回空 data，不連網', async () => {
  eagle.setReady(false);
  const r = await eagle.callEagle('item_get', { url: 'https://x.com' });
  assert.deepStrictEqual(r, { data: [] });
  eagle.setReady(true);
});

// --- callEagle 正常模式：未支援動作丟明確錯誤（switch default，不連網）---
test('callEagle: 未支援動作丟錯', async () => {
  eagle.setReady(true);
  await assert.rejects(() => eagle.callEagle('definitely_not_a_tool'), /未支援的動作/);
});
