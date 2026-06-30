'use strict';
/**
 * lib/log.js — 日誌 / 進度回報 / 桌面通知。
 *
 * 從 bot.js 抽出的橫切工具：log() 是全專案最常用的函式（圖譜上最大的 god node、
 * 橋接多個社群），各模組都可 require('./log') 共用，不再依附 bot.js。
 * 設計原則：零 runtime 套件相依，只用 Node 內建模組。
 */

const { spawn } = require('child_process');

// 本地時間戳（toISOString 是 UTC，會讓 log 時間少 8 小時，故自己組本地時間）
const pad2 = (n) => String(n).padStart(2, '0');
const localStamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

const log = (...args) => {
  console.log(`[${localStamp()}]`, ...args);
};

// 進度回報給 dashboard（server 端會攔成 runState.progress，不顯示在 log）
const emitProgress = (done, total) => { if (total > 0) console.log(`__GLEAN_PROGRESS__ ${done} ${total}`); };

// macOS 桌面通知（用 osascript，零依賴）。讀 config 的 notifyOnFinish 決定是否發送。
function notify(title, body) {
  let cfg = {};
  try { cfg = require('./config').loadConfig(); } catch { /* 設定載入失敗就照預設發送 */ }
  if (cfg.notifyOnFinish === false) return;
  const escTitle = String(title).replace(/[\\"]/g, '\\$&');
  const escBody = String(body).replace(/[\\"]/g, '\\$&').replace(/\n/g, ' · ');
  try {
    spawn('osascript', [
      '-e',
      `display notification "${escBody}" with title "${escTitle}"`,
    ]);
  } catch {
    /* 通知失敗不影響主流程 */
  }
}

module.exports = { pad2, localStamp, log, emitProgress, notify };
