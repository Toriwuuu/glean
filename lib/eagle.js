'use strict';
/**
 * lib/eagle.js — Eagle 內建 REST API 相容層 + 可用性狀態。
 *
 * 從 bot.js 抽出：對外保留原本的 callEagle(tool, params) 介面，內部全部打 Eagle 內建
 * REST API（Eagle App 一開啟就有，不需任何 plugin）。同時擁有「Eagle 是否可用」狀態
 * （原 bot.js 的 EAGLE_OK），對外以 isReady() 讀、setReady() 寫——啟動時由 bot.js 的
 * 探測流程依「設定是否關閉 Eagle」與「Eagle 是否連得上」決定要不要降級。
 * 設計原則：零 runtime 套件相依，只用 Node 內建 + 全域 fetch。
 */

const fs = require('fs');
const { log } = require('./log');
const i18n = require('./i18n');
const obsidian = require('./obsidian');

// Eagle 內建 REST API（預設 http://localhost:41595，可用環境變數覆寫）
const EAGLE_API = process.env.EAGLE_API_BASE || 'http://localhost:41595';
const EAGLE_API_TOKEN = process.env.EAGLE_API_TOKEN || '';

// 可用性旗標：false 時進入降級模式，除了探測 app info 外所有 Eagle 操作安全 no-op。
// 只輸出 Obsidian 筆記（媒體存進附件）。狀態由 bot.js 啟動流程呼叫 setReady() 設定。
let ready = true;
function isReady() { return ready; }
function setReady(v) { ready = v !== false; }

// URL 正規化：拿掉常見的 utm / ref query，方便和 listing URL 對齊（去重用）。
function normalizeUrl(u) {
  if (!u) return u;
  return u.replace(/[?&](ref|utm_\w+)=[^&]*/gi, '').replace(/[?&]$/, '').trim();
}

// 預載指定資料夾裡的所有 annotation，用 regex 抽出某個 key 的 URL（例：Awwwards: https://...）
// 目的：在進 detail 頁之前就過濾掉已抓過的項目，省下大量網路請求
async function loadExistingUrlsFromAnnotation(folderId, pattern) {
  if (!ready) return new Set();
  try {
    const existing = await callEagle('item_get', {
      folders: [folderId],
      fullDetails: true,
      limit: 1000,
    });
    const list = existing?.data || existing?.result || existing;
    const set = new Set();
    if (Array.isArray(list)) {
      for (const it of list) {
        const m = (it.annotation || '').match(pattern);
        if (m) set.add(normalizeUrl(m[1]));
      }
    }
    return set;
  } catch (e) {
    log(i18n.t('cli.eagle.loadExistingFail', { msg: e.message }));
    return new Set();
  }
}

// ---------- Eagle 內建 REST API 相容層 ----------
// 對外保留原本的 callEagle(tool, params) 介面，內部全部改打 Eagle 內建 API。
// 好處：bot.js 其他地方一行都不用改，也不再依賴 Claude skill 或 Eagle MCP plugin。

async function eagleFetch(method, pathname, { query, body } = {}) {
  const qs = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
  }
  if (EAGLE_API_TOKEN) qs.set('token', EAGLE_API_TOKEN);
  const q = qs.toString();
  const url = EAGLE_API + pathname + (q ? `?${q}` : '');
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let r;
  try {
    r = await fetch(url, opts);
  } catch (e) {
    throw new Error(`Eagle API 連不上（${EAGLE_API}）：${e.message}`);
  }
  let json = null;
  try { json = await r.json(); } catch { /* 非 JSON 回應 */ }
  if (!r.ok || (json && json.status && json.status !== 'success')) {
    const msg = (json && (json.message || JSON.stringify(json))) || `HTTP ${r.status}`;
    throw new Error(`Eagle API 錯誤 (${pathname}): ${msg}`);
  }
  return json;
}

// 「依 URL 找」是兜底去重用的，但內建 API 不支援 url 過濾。
// 折衷：掃近 1000 筆最新項目，比對 item.url 或 annotation 內含這個網址。
// 加 5 分鐘快取，避免 loop 裡每筆都重撈。
let _recentCache = { at: 0, items: [] };
async function eagleRecentItems() {
  if (_recentCache.items.length && Date.now() - _recentCache.at < 5 * 60 * 1000) {
    return _recentCache.items;
  }
  const j = await eagleFetch('GET', '/api/item/list', { query: { limit: 1000 } });
  _recentCache = { at: Date.now(), items: j?.data || [] };
  return _recentCache.items;
}

// 內建 API 的 folders 過濾「不含子資料夾」，但舊 MCP 是會遞迴的。
// Mobbin / Land-book 的 item 都被 reorganize 搬進子資料夾，所以查根資料夾時
// 要把每個 folder id 展開成「自己 + 所有子孫」，否則月報 / 縮圖牆會看不到它們。
let _folderTreeCache = { at: 0, tree: [] };
async function eagleFolderTree() {
  if (_folderTreeCache.tree.length && Date.now() - _folderTreeCache.at < 60 * 1000) {
    return _folderTreeCache.tree;
  }
  const j = await eagleFetch('GET', '/api/folder/list');
  _folderTreeCache = { at: Date.now(), tree: j?.data || [] };
  return _folderTreeCache.tree;
}
function collectDescendantIds(nodes, wanted, acc, capturing) {
  for (const f of nodes) {
    const isTarget = capturing || wanted.has(f.id);
    if (isTarget) acc.add(f.id);
    if (f.children && f.children.length) {
      collectDescendantIds(f.children, wanted, acc, isTarget);
    }
  }
  return acc;
}
async function expandFolderIds(ids) {
  const wanted = new Set(ids);
  const tree = await eagleFolderTree();
  const acc = collectDescendantIds(tree, wanted, new Set(), false);
  for (const id of ids) acc.add(id); // 保底：要求的 id 一定包含
  return [...acc];
}

async function callEagle(tool, params = {}) {
  // 降級模式：除了探測 app info 外，所有 Eagle 操作都安全 no-op
  if (!ready && tool !== 'get_app_info') {
    if (tool === 'item_add') return { data: { added: 0 } };
    return { data: [] };
  }
  switch (tool) {
    case 'get_app_info':
      return eagleFetch('GET', '/api/application/info');

    case 'folder_get': {
      // 內建 /api/folder/list 直接回完整巢狀資料夾樹（每層有 children）
      const j = await eagleFetch('GET', '/api/folder/list');
      return { data: j?.data || [] };
    }

    case 'folder_create': {
      const out = [];
      for (const f of params.folders || []) {
        const j = await eagleFetch('POST', '/api/folder/create', {
          body: { folderName: f.name, ...(f.parentId ? { parent: f.parentId } : {}) },
        });
        if (j?.data) out.push(j.data);
      }
      _folderTreeCache.at = 0; // 新資料夾建好，失效快取
      return { data: out };
    }

    case 'item_get': {
      if (params.url) {
        const target = normalizeUrl(params.url);
        const items = await eagleRecentItems();
        const hit = items.filter(
          (it) =>
            normalizeUrl(it.url || '') === target ||
            (it.annotation || '').includes(params.url)
        );
        return { data: hit.slice(0, params.limit || hit.length) };
      }
      const query = { limit: params.limit || 200 };
      if (params.folders && params.folders.length) {
        query.folders = await expandFolderIds(params.folders); // 含子資料夾
      }
      if (params.tags && params.tags.length) query.tags = params.tags;
      const j = await eagleFetch('GET', '/api/item/list', { query });
      return { data: j?.data || [] };
    }

    case 'item_add': {
      const sharedTags = params.tags || [];
      const folderId = (params.folders || [])[0];
      let ok = 0;
      let lastErr = null;
      for (const it of params.items || []) {
        const src = it.source || {};
        const mediaUrl = src.url;
        try {
          await eagleFetch('POST', '/api/item/addFromURL', {
            body: {
              url: mediaUrl,
              name: it.name || 'untitled',
              // 跟舊 MCP plugin 行為一致：item.url 存「來源頁網址」(作品/詳情頁)，
              // 不是媒體檔網址。這樣新舊資料一致，dashboard 邏輯不用改。
              // 點擊用的連結是 dashboard 從 annotation 解析的，不靠 item.url。
              website: src.website || mediaUrl,
              tags: [...sharedTags, ...(it.tags || [])],
              annotation: it.annotation || params.annotation || '',
              ...(folderId ? { folderId } : {}),
            },
          });
          ok++;
        } catch (e) {
          lastErr = e;
        }
      }
      if (ok === 0 && lastErr) throw lastErr;
      _recentCache.at = 0; // 失效快取，讓後續去重看得到剛加進去的
      return { data: { added: ok } };
    }

    case 'item_update': {
      for (const it of params.items || []) {
        const body = { id: it.id };
        const folders = it.folders || params.folders;
        const tags = it.tags || params.tags;
        const annotation = it.annotation ?? params.annotation;
        if (folders) body.folders = folders;
        if (tags) body.tags = tags;
        if (annotation !== undefined) body.annotation = annotation;
        await eagleFetch('POST', '/api/item/update', { body });
      }
      return { data: { updated: (params.items || []).length } };
    }

    default:
      throw new Error(`callEagle: 未支援的動作 ${tool}`);
  }
}

// 找剛加進 Eagle 的 item id（addFromURL 不回傳 id，故事後用 folder + website 比對最近項目）
// Eagle 剛 addFromURL 後索引可能有短暫延遲，所以最多重試 3 次、間隔 1.5 秒。
async function findRecentItemId(folderId, website, name) {
  if (!folderId) return null;
  const target = normalizeUrl(website || '');
  if (!target) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const folders = await expandFolderIds([folderId]);
      const j = await eagleFetch('GET', '/api/item/list', { query: { folders, limit: 80 } });
      const list = j?.data || [];
      let hit = list.find((it) => normalizeUrl(it.url || '') === target && (!name || it.name === name));
      if (!hit) hit = list.find((it) => normalizeUrl(it.url || '') === target);
      if (hit?.id) return hit.id;
    } catch { /* ignore，等下重試 */ }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

// Eagle 資料夾
async function ensureFolder(name) {
  if (!ready) return null;
  const tree = await callEagle('folder_get', { getAllHierarchy: true, fullDetails: true });
  const list = tree?.data || tree?.result || tree;
  const found = findFolderByName(list, name);
  if (found) {
    log(i18n.t('cli.eagle.folderFound', { name, id: found.id }));
    return found.id;
  }
  log(i18n.t('cli.eagle.folderCreate', { name }));
  const created = await callEagle('folder_create', { folders: [{ name }] });
  const newFolder = (created?.data || created?.result || created)?.[0] || created;
  return newFolder.id || newFolder.folderId;
}

function findFolderByName(folders, name) {
  if (!Array.isArray(folders)) return null;
  for (const f of folders) {
    if (f.name === name) return f;
    const sub = findFolderByName(f.children || f.folders || [], name);
    if (sub) return sub;
  }
  return null;
}

// 雙向連結：把 Eagle 連結回填進筆記（找得到 item 連到 item，否則連到 folder）
async function linkNoteWithEagle({ notePath, folderId, website, name }) {
  if (!notePath) return;
  let id = null;
  try { id = await findRecentItemId(folderId, website, name); } catch { /* ignore */ }
  const link = id ? `eagle://item/${id}` : (folderId ? `eagle://folder/${folderId}` : null);
  if (link) { try { obsidian.addEagleLinkToNote(notePath, link); } catch { /* ignore */ } }
}


function findDirectChildByName(folders, name) {
  if (!Array.isArray(folders)) return null;
  return folders.find((f) => f.name === name) || null;
}

// 依路徑（陣列）確保整條資料夾鏈存在；沒有就一層一層建。回傳最末層 folder id
// 例：ensureFolderPath(['Mobbin', 'iOS', 'SaaS']) → 'leafFolderId'
async function ensureFolderPath(pathArray) {
  if (!isReady()) return null;
  if (!Array.isArray(pathArray) || !pathArray.length) {
    throw new Error('ensureFolderPath: 空路徑');
  }
  const tree = await callEagle('folder_get', { getAllHierarchy: true, fullDetails: true });
  let level = tree?.data || tree?.result || tree || [];
  let parentId = null;
  let leafId = null;
  for (const segment of pathArray) {
    const existing = findDirectChildByName(level, segment);
    if (existing) {
      leafId = existing.id;
      parentId = existing.id;
      level = existing.children || existing.folders || [];
    } else {
      const created = await callEagle('folder_create', {
        folders: [{ name: segment, ...(parentId ? { parentId } : {}) }],
      });
      const newFolder = (created?.data || created?.result || created)?.[0] || created;
      leafId = newFolder.id || newFolder.folderId;
      parentId = leafId;
      level = [];
      log(i18n.t('cli.eagle.folderPathCreate', { path: pathArray.slice(0, pathArray.indexOf(segment) + 1).join(' / ') }));
    }
  }
  return leafId;
}

// 把本機檔案加進 Eagle（callEagle 的 item_add 走 addFromURL、只支援網址；本機檔走 addFromPath）。
// 回傳 Eagle 新項目 id（/api/item/addFromPath 會回 item id），降級或失敗回 null。
async function addFromPath({ path: filePath, name, tags = [], annotation = '', folderId } = {}) {
  if (!ready || !filePath) return null;
  try {
    const j = await eagleFetch('POST', '/api/item/addFromPath', {
      body: {
        path: filePath,
        name: name || 'untitled',
        tags,
        annotation,
        ...(folderId ? { folderId } : {}),
      },
    });
    _recentCache.at = 0; // 失效快取，讓後續看得到剛加進去的
    return j?.data || null;
  } catch (e) {
    log(i18n.t('cli.local.eagleAddFail', { msg: e.message }));
    return null;
  }
}

// 取某 Eagle 項目的本機圖片路徑（用內建 thumbnail API 回傳的本機檔），供視覺分析讀圖。
async function resolveItemImagePath(id) {
  if (!ready || !id) return null;
  try {
    const j = await eagleFetch('GET', '/api/item/thumbnail', { query: { id } });
    const p = j?.data ? decodeURIComponent(j.data) : null;
    return p && fs.existsSync(p) ? p : null;
  } catch { return null; }
}

module.exports = {
  isReady,
  setReady,
  normalizeUrl,
  loadExistingUrlsFromAnnotation,
  eagleFetch,
  eagleRecentItems,
  eagleFolderTree,
  collectDescendantIds,
  expandFolderIds,
  callEagle,
  findRecentItemId,
  ensureFolder,
  findFolderByName,
  linkNoteWithEagle,
  findDirectChildByName,
  ensureFolderPath,
  addFromPath,
  resolveItemImagePath,
};
