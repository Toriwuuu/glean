'use strict';
/**
 * lib/obsidian.js — Obsidian 輸出相關工具
 *
 * Phase 1：路徑推導 / slug / 原子寫檔（Claude 直接 Write 筆記，這裡負責算路徑與確保資料夾）。
 * Phase 2 會再加：downloadToAttachment（無 Eagle 時下載媒體）、雙向連結組裝。
 * 設計原則：零 runtime 套件相依，只用 Node 內建模組。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// 留空 vaultDir 時的預設知識庫位置（自動建立，讓沒填路徑的人也能直接用）
const DEFAULT_VAULT = path.join(os.homedir(), 'Documents', 'Glean');
function expandHome(p) {
  if (!p) return '';
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function ensureDir(d) { if (d) fs.mkdirSync(d, { recursive: true }); }

// 原子寫入：先寫 .tmp 再 rename，避免讀到半截
function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// 本地日字串 YYYY-MM-DD（用本地時區，避免 UTC 偏移把「今天」算錯一天）
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 產品/網站名 → 檔名 slug（小寫英數 + 連字號）。純非英數名稱會退回 'untitled'。
function slugify(name) {
  const s = String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

// 依設定推導 Obsidian 相關路徑
function notePaths(cfg) {
  const o = (cfg && cfg.obsidian) || {};
  const vault = expandHome(o.vaultDir) || DEFAULT_VAULT;   // 留空 → 預設 ~/Documents/Glean（自動建立）
  const sub = o.dailySubdir || 'inspiration-daily';
  const att = o.attachmentsSubdir || 'attachments';
  return {
    vaultDir: vault,
    notesDir: path.join(vault, sub),
    attachmentsDir: path.join(vault, sub, att),
    indexFile: path.join(vault, sub, '_index.md'),
  };
}

// 確保 vault 存在且是個 Obsidian 知識庫（建 .obsidian），讓「留空自動建立」的人也能用雙向連結與 Base
function ensureVault(cfg) {
  const { vaultDir, notesDir, attachmentsDir } = notePaths(cfg);
  try {
    ensureDir(notesDir);
    ensureDir(attachmentsDir);
    const dot = path.join(vaultDir, '.obsidian');
    if (!fs.existsSync(dot)) {
      ensureDir(dot);
      try { fs.writeFileSync(path.join(dot, 'app.json'), '{}\n'); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return vaultDir;
}

function noteFile(cfg, slug) {
  const p = notePaths(cfg);
  return p.notesDir ? path.join(p.notesDir, `${slug}.md`) : '';
}

// 直接由 eib 寫筆記（Phase 2 雙向連結時會用到；Phase 1 多半交給 Claude 自己 Write）
function writeNote(cfg, slug, content) {
  const p = notePaths(cfg);
  if (!p.notesDir) return null;
  ensureDir(p.notesDir);
  const file = path.join(p.notesDir, `${slug}.md`);
  atomicWrite(file, content);
  return file;
}

// ── Obsidian vault 偵測 / 連結 ─────────────────────────────
// 從某資料夾往上找含 .obsidian 的目錄＝vault 根（basename 即 vault 名稱）
function findVault(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12 && dir; i++) {
    try { if (fs.existsSync(path.join(dir, '.obsidian'))) return { root: dir, name: path.basename(dir) }; } catch { /* ignore */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// 相對路徑（一律用 / 分隔，給 Obsidian / Base 用）
function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

// 產生 obsidian://open 深連結（找不到 vault 回 null）
function obsidianUri(notePath) {
  if (!notePath) return null;
  const v = findVault(path.dirname(notePath));
  if (!v) return null;
  const rel = relPosix(v.root, notePath).replace(/\.md$/i, '');
  return `obsidian://open?vault=${encodeURIComponent(v.name)}&file=${encodeURIComponent(rel)}`;
}

// 把 Eagle 連結回填進筆記：frontmatter 加 eagle 欄位 + 文末加一個可點連結（冪等）
function addEagleLinkToNote(notePath, eagleLink) {
  if (!notePath || !eagleLink) return false;
  let text;
  try { text = fs.readFileSync(notePath, 'utf8'); } catch { return false; }
  if (text.includes(eagleLink)) return true; // 已有，不重複
  // 1) frontmatter 插入 eagle 欄位（在結尾 --- 之前）
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1 && !/^eagle:\s*/m.test(text.slice(0, end))) {
      text = text.slice(0, end) + `\neagle: ${eagleLink}` + text.slice(end);
    }
  }
  // 2) 文末加一行可點連結
  text = text.replace(/\s*$/, '\n') + `\n- Eagle 收藏：[在 Eagle 開啟](${eagleLink})\n`;
  atomicWrite(notePath, text);
  return true;
}

// ── Obsidian Base 表格 ────────────────────────────────────
function buildBaseYaml(relFolder) {
  return `filters:
  and:
    - file.inFolder("${relFolder}")
    - file.ext == "md"
    - file.name != "_index"
formulas:
  summary: if(title.contains(" — "), title.split(" — ")[1], title)
properties:
  note.site:
    displayName: 擷取來源
  note.category:
    displayName: 分類
  note.platform:
    displayName: 平台
  note.patterns:
    displayName: 設計模式
  note.date:
    displayName: 日期
  note.month:
    displayName: 月份
  note.source:
    displayName: 原始連結
  note.eagle:
    displayName: Eagle
  formula.summary:
    displayName: 簡介
views:
  - type: table
    name: 全部
    order:
      - file.name
      - formula.summary
      - site
      - category
      - platform
      - patterns
      - date
      - source
      - eagle
    sort:
      - property: date
        direction: DESC
  - type: table
    name: 依來源
    groupBy:
      property: site
      direction: ASC
    order:
      - file.name
      - formula.summary
      - category
      - platform
      - patterns
      - date
    sort:
      - property: date
        direction: DESC
  - type: table
    name: 依分類
    groupBy:
      property: category
      direction: ASC
    order:
      - file.name
      - formula.summary
      - site
      - platform
      - patterns
      - date
    sort:
      - property: date
        direction: DESC
  - type: table
    name: 依月份
    groupBy:
      property: month
      direction: DESC
    order:
      - file.name
      - formula.summary
      - site
      - category
      - patterns
      - date
    sort:
      - property: category
        direction: ASC
  - type: table
    name: 依設計模式
    groupBy:
      property: patterns
      direction: ASC
    order:
      - file.name
      - formula.summary
      - site
      - category
      - platform
      - date
    sort:
      - property: date
        direction: DESC
`;
}

// 確保 vault 裡有對應的 .base 表格（已存在就不覆蓋，保留使用者調整）
function ensureBase(cfg) {
  const p = notePaths(cfg);
  if (!p.notesDir || !p.vaultDir) return null;
  const o = (cfg && cfg.obsidian) || {};
  const sub = o.dailySubdir || 'inspiration-digest';
  const baseFile = path.join(p.vaultDir, `${sub}.base`);
  if (fs.existsSync(baseFile)) return baseFile;
  const v = findVault(p.notesDir);
  const relFolder = v ? relPosix(v.root, p.notesDir) : sub;
  try { ensureDir(path.dirname(baseFile)); fs.writeFileSync(baseFile, buildBaseYaml(relFolder)); } catch { return null; }
  return baseFile;
}

// ── 沒有 Eagle 時的降級：把媒體下載到 Obsidian 附件並嵌入筆記 ──
async function downloadToAttachment(url, slug, cfg) {
  const p = notePaths(cfg);
  if (!p.attachmentsDir || !url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const len = parseInt(res.headers.get('content-length') || '0', 10);
    if (len && len > 60 * 1024 * 1024) return null; // 太大（>60MB）不下載
    const ct = res.headers.get('content-type') || '';
    let ext = (url.split('?')[0].match(/\.([a-z0-9]{2,5})$/i)?.[1] || '').toLowerCase();
    if (!ext) {
      ext = /video/.test(ct) ? 'mp4' : /png/.test(ct) ? 'png' : /webp/.test(ct) ? 'webp' : /gif/.test(ct) ? 'gif' : 'jpg';
    }
    ensureDir(p.attachmentsDir);
    const fileName = `${slug}.${ext}`;
    fs.writeFileSync(path.join(p.attachmentsDir, fileName), Buffer.from(await res.arrayBuffer()));
    return { fileName, isVideo: /^(mp4|webm|mov|m4v)$/i.test(ext) };
  } catch { return null; }
}

// 把附件嵌入筆記（Obsidian wikilink embed，圖片與影片都適用）。冪等。
function embedMediaInNote(notePath, fileName) {
  if (!notePath || !fileName) return false;
  try {
    let text = fs.readFileSync(notePath, 'utf8');
    if (text.includes(`[[${fileName}]]`)) return true;
    text = text.replace(/\s*$/, '\n') + `\n![[${fileName}]]\n`;
    atomicWrite(notePath, text);
    return true;
  } catch { return false; }
}

// 把本機圖片複製進 Obsidian 附件（BYO：inbox 檔或 Eagle 來源項目的本機圖都用這個），回傳檔名供嵌入。
function copyToAttachment(srcPath, slug, cfg) {
  const p = notePaths(cfg);
  if (!p.attachmentsDir || !srcPath) return null;
  try {
    if (!fs.existsSync(srcPath)) return null;
    let ext = (path.extname(srcPath).slice(1) || 'png').toLowerCase();
    if (!/^(png|jpe?g|webp|gif)$/i.test(ext)) ext = 'png';
    ensureDir(p.attachmentsDir);
    const fileName = `${slug}.${ext}`;
    fs.copyFileSync(srcPath, path.join(p.attachmentsDir, fileName));
    return fileName;
  } catch { return null; }
}

module.exports = {
  ensureDir, atomicWrite, localDateStr, slugify, notePaths, noteFile, writeNote,
  findVault, obsidianUri, addEagleLinkToNote, ensureBase,
  downloadToAttachment, copyToAttachment, embedMediaInNote, ensureVault, DEFAULT_VAULT,
};
