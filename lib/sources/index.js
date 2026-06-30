'use strict';
/**
 * lib/sources/index.js — 靈感來源登記表與統一入口（鏡像 lib/engines/index.js）。
 * 每個來源模組對外提供 runFlow(globalStats, opts)。
 * BYO 版只有一個來源：local（使用者自帶圖片：Eagle 來源資料夾 / 本機 inbox）。
 */
const local = require('./local');

const SOURCES = { local };

function getSource(id) { return SOURCES[id] || null; }
function listSources() { return Object.keys(SOURCES); }
function runFlow(id, globalStats, opts) {
  const s = getSource(id);
  if (!s) throw new Error(`未知來源：${id}`);
  return s.runFlow(globalStats, opts);
}

module.exports = {
  getSource,
  listSources,
  runFlow,
  runLocalFlow: local.runFlow,
};
