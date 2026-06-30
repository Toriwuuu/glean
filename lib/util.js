'use strict';
/**
 * lib/util.js — 共用小工具。
 */

// ISO 週數（給分類輪換用，可重現、跨年正確）
function getIsoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

module.exports = { getIsoWeek };
