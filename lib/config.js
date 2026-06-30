'use strict';
/**
 * lib/config.js — 統一設定載入（取代 bot.js 直接 JSON.parse）
 *
 * 讀 config.json 為權威，再用 mergeDefaults 補上「分析 / Obsidian / Eagle」新區塊與
 * 每來源的 analyze 旗標，讓舊 config.json 不用手動改也能有完整結構。
 * 設計原則：零 runtime 套件相依，只用 Node 內建模組。
 */

const fs = require('fs');
const path = require('path');
const sections = require('./sections');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_JSON = path.join(ROOT, 'config.json');
const CONFIG_EXAMPLE = path.join(ROOT, 'config.example.json');

function defaultAnalysis() {
  return {
    enabled: true,            // 全域分析總開關
    mode: 'full',             // full = 完整 AI 分析；image = 只存圖（不呼叫 Claude）
    maxAnalysesPerRun: 20,    // 每次跑的分析上限（節流，控制 Claude 成本）
    claudeBin: '',            // 空 = 自動用 PATH 上的 claude
    model: 'sonnet',          // sonnet 省成本 / opus 更深入
    userRole: '資深 UI/UX 設計研究者',
    audience: '想豐富作品集的 UI/UX 設計師',
    sections: sections.DEFAULT_KEYS.slice(),
    customSections: [],
  };
}

function defaultObsidian() {
  return {
    enabled: true,
    vaultDir: '',                       // 知識庫資料夾（必填才會輸出筆記）
    dailySubdir: 'inspiration-daily',   // 筆記子資料夾
    attachmentsSubdir: 'attachments',   // 媒體/圖片下載目的地
    maintainIndex: true,                // 是否維護 _index.md
  };
}

// BYO（自帶靈感）來源預設：使用者自己收集的圖片，不爬任何網站
function defaultLocal() {
  return {
    enabled: true,
    mode: 'eagle',                        // 'eagle'＝讀 Eagle 來源資料夾；'inbox'＝讀本機資料夾
    eagleSourceFolderName: 'Glean Inbox', // Eagle 模式：要分析的「來源」資料夾（把圖丟這）
    eagleFolderName: 'Glean',             // inbox 模式：把本機圖收進 Eagle 的目的資料夾
    inboxDir: '',                         // inbox 模式：本機資料夾（留空＝~/Glean/inbox）
    analyze: true,
    maxPerRun: 20,                        // 每次跑最多分析幾張（節流）
    extraTags: ['glean'],
  };
}

// 補齊新區塊與每來源 analyze 旗標；既有鍵一律保留、只填缺漏，避免覆蓋使用者設定
function mergeDefaults(cfg) {
  const out = cfg && typeof cfg === 'object' ? cfg : {};
  out.language = out.language || 'en';   // 介面語言（en 預設，zh-TW 可切）
  out.analysis = { ...defaultAnalysis(), ...(out.analysis || {}) };
  if (!Array.isArray(out.analysis.sections)) out.analysis.sections = sections.DEFAULT_KEYS.slice();
  if (!Array.isArray(out.analysis.customSections)) out.analysis.customSections = [];
  out.obsidian = { ...defaultObsidian(), ...(out.obsidian || {}) };
  out.eagle = { enabled: true, ...(out.eagle || {}) };
  out.local = { ...defaultLocal(), ...(out.local || {}) };
  return out;
}

// 讀設定：config.json 為權威；補上預設後回傳。
function loadConfig() {
  // 第一次跑（沒有 config.json）→ 用 config.example.json 種一份，讓全新 clone 也能直接動
  if (!fs.existsSync(CONFIG_JSON) && fs.existsSync(CONFIG_EXAMPLE)) {
    try { fs.copyFileSync(CONFIG_EXAMPLE, CONFIG_JSON); } catch { /* ignore */ }
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_JSON, 'utf8'));
  } catch (e) {
    // 還是讀不到 → 退而用範本，再不行用空物件，不要整個崩潰
    try { raw = JSON.parse(fs.readFileSync(CONFIG_EXAMPLE, 'utf8')); } catch { raw = {}; }
  }
  return mergeDefaults(raw);
}

module.exports = { loadConfig, mergeDefaults, defaultAnalysis, defaultObsidian, defaultLocal, CONFIG_JSON, CONFIG_EXAMPLE, ROOT };
