'use strict';
/**
 * lib/i18n.js — CLI（Node 端）的輕量多語字串。
 * 載入 en / zh-TW 對照表；t(key, params) 取字、setLang 切語言，預設 en。
 * 字串內 {name} 形式的佔位會用 params 取代。
 * 注意：只翻譯「使用者看得到的」輸出，程式碼中文註解不在範圍。
 */
const en = require('./i18n/en.json');
const zhTW = require('./i18n/zh-TW.json');

const BUNDLES = { en, 'zh-TW': zhTW };
let current = 'en';

function setLang(lang) {
  current = BUNDLES[lang] ? lang : 'en';
  return current;
}

function getLang() { return current; }

function interpolate(str, params) {
  if (!params) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
}

// 取字：目前語言 → 英文 → 鍵名本身（缺鍵也不會壞）
function t(key, params) {
  const b = BUNDLES[current] || en;
  const s = (b && b[key] != null) ? b[key] : (en[key] != null ? en[key] : key);
  return interpolate(s, params);
}

module.exports = { t, setLang, getLang };
