'use strict';
/**
 * lib/sources/local.js — BYO（自帶靈感）來源流程。
 *
 * 不爬任何網站；處理「使用者自己收集的圖片」，兩種模式（config.local.mode）：
 *   - 'eagle'：讀指定 Eagle 來源資料夾裡「尚未分析」的項目 → 視覺分析 → 寫 Obsidian 筆記
 *              → 雙向串接，並在該 Eagle 項目加 glean-analyzed tag（去重，下次不重複分析）。
 *   - 'inbox'：讀本機 inbox 資料夾的圖片 → 視覺分析 →（有 Eagle 就把圖收進 Eagle）
 *              → 處理完移到 done/。
 * 對外提供統一介面 runFlow(globalStats, opts)（鏡像其他來源）。
 * opts: { manual, manualTarget, analyzer, runId }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { log } = require('../log');
const i18n = require('../i18n');
const CONFIG = require('../config').loadConfig();
const obsidian = require('../obsidian');
const {
  ensureFolder, findFolderByName, callEagle, isReady,
  addFromPath, resolveItemImagePath,
} = require('../eagle');

const IMG_RE = /\.(png|jpe?g|webp|gif)$/i;
const ANALYZED_TAG = 'glean-analyzed';

function expandHome(p) {
  if (!p) return p;
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

// 檔名/項目名 → 乾淨標題
function titleFromName(name) {
  return String(name || '').replace(IMG_RE, '').replace(/[-_]+/g, ' ').trim() || 'untitled';
}

// 把 Obsidian 連結併進 annotation（冪等）
function withObsidian(ann, notePath) {
  const uri = obsidian.obsidianUri(notePath);
  if (!uri) return ann || '';
  if ((ann || '').includes(uri)) return ann || '';
  return ((ann || '') + (ann ? '\n' : '') + `Obsidian: ${uri}`).trim();
}

async function runLocalFlow(globalStats, opts = {}) {
  const cfg = CONFIG.local || {};
  if (cfg.enabled === false) { log(i18n.t('cli.local.disabled')); return; }

  const analyzer = opts.analyzer;
  if (!analyzer || !analyzer.notesOn) { log(i18n.t('cli.local.noNotes')); return; }

  const eagleOn = isReady() && CONFIG.eagle?.enabled !== false;
  // mode：設定優先；未指定時有 Eagle 走 eagle、沒 Eagle 走 inbox
  const mode = cfg.mode === 'inbox' ? 'inbox'
    : cfg.mode === 'eagle' ? 'eagle'
    : (eagleOn ? 'eagle' : 'inbox');
  const limit = (opts.manual && opts.manualTarget)
    ? opts.manualTarget
    : (Number.isFinite(cfg.maxPerRun) ? cfg.maxPerRun : 20);
  const stats = { analyzed: 0, skipped: 0, failed: 0 };

  if (mode === 'eagle' && eagleOn) {
    await runEagleFolderMode({ cfg, analyzer, limit, stats });
  } else {
    if (mode === 'eagle' && !eagleOn) log(i18n.t('cli.local.eagleModeNoEagle'));
    await runInboxMode({ cfg, analyzer, eagleOn, limit, stats, opts });
  }

  log(i18n.t('cli.local.result', stats));
  globalStats.local = stats;
}

// ── Eagle 來源資料夾模式 ─────────────────────────────────────
async function runEagleFolderMode({ cfg, analyzer, limit, stats }) {
  log(i18n.t('cli.local.headerEagle'));
  const srcName = cfg.eagleSourceFolderName || 'Glean Inbox';
  const tree = await callEagle('folder_get', {});
  const folder = findFolderByName(tree?.data || tree?.result || tree, srcName);
  if (!folder) { log(i18n.t('cli.local.noEagleFolder', { name: srcName })); return; }

  const res = await callEagle('item_get', { folders: [folder.id], limit: 500 });
  const all = res?.data || [];
  const items = all.filter((it) => !(it.tags || []).includes(ANALYZED_TAG));
  log(i18n.t('cli.local.eagleScan', { name: srcName, count: items.length }));

  let i = 0;
  for (const it of items) {
    if (stats.analyzed >= limit) break;
    i++;
    const title = it.name || titleFromName(it.name);
    log(i18n.t('cli.local.itemHeader', { i, total: items.length, title }));
    try {
      const imgPath = await resolveItemImagePath(it.id);
      if (!imgPath) { log(i18n.t('cli.local.noImage')); stats.skipped++; continue; }
      const ref = analyzer.refFor(title);
      const slug = ref ? ref.slug : obsidian.slugify(title);
      const attachName = obsidian.copyToAttachment(imgPath, slug, CONFIG);
      const attachFull = attachName
        ? path.join(obsidian.notePaths(CONFIG).attachmentsDir, attachName)
        : imgPath;
      const note = await analyzer.analyzeVision({
        source: 'Local', sourceTag: 'local', title,
        detailUrl: it.url || '', sourceCategory: '',
        imagePath: attachFull, slug,
      });
      if (!note) { stats.failed++; continue; }
      if (attachName) obsidian.embedMediaInNote(note.notePath, attachName);
      try { obsidian.addEagleLinkToNote(note.notePath, `eagle://item/${it.id}`); } catch { /* ignore */ }
      // 標記已分析（去重）+ 寫回 Obsidian 連結，保留原 tags
      const newTags = [...new Set([...(it.tags || []), ANALYZED_TAG, ...(cfg.extraTags || [])])];
      try {
        await callEagle('item_update', {
          items: [{ id: it.id, tags: newTags, annotation: withObsidian(it.annotation, note.notePath) }],
        });
      } catch { /* ignore */ }
      stats.analyzed++;
      log(i18n.t('cli.local.analyzed'));
    } catch (e) {
      log(i18n.t('cli.local.analysisError', { msg: e.message }));
      stats.failed++;
    }
  }
}

// ── 本機 inbox 資料夾模式 ────────────────────────────────────
async function runInboxMode({ cfg, analyzer, eagleOn, limit, stats, opts }) {
  log(i18n.t('cli.local.headerInbox'));
  const inboxDir = expandHome(cfg.inboxDir) || path.join(os.homedir(), 'Glean', 'inbox');
  if (!fs.existsSync(inboxDir)) {
    fs.mkdirSync(inboxDir, { recursive: true });
    log(i18n.t('cli.local.inboxCreated', { dir: inboxDir }));
    return;
  }
  const doneDir = path.join(inboxDir, 'done');
  const files = fs.readdirSync(inboxDir)
    .filter((f) => IMG_RE.test(f))
    .filter((f) => { try { return fs.statSync(path.join(inboxDir, f)).isFile(); } catch { return false; } });
  log(i18n.t('cli.local.inboxScan', { dir: inboxDir, count: files.length }));

  let folderId = null;
  if (eagleOn) { try { folderId = await ensureFolder(cfg.eagleFolderName || 'Glean'); } catch { /* ignore */ } }

  let i = 0;
  for (const f of files) {
    if (stats.analyzed >= limit) break;
    i++;
    const filePath = path.join(inboxDir, f);
    const title = titleFromName(f);
    log(i18n.t('cli.local.itemHeader', { i, total: files.length, title }));
    try {
      const ref = analyzer.refFor(title);
      const slug = ref ? ref.slug : obsidian.slugify(title);
      const attachName = obsidian.copyToAttachment(filePath, slug, CONFIG);
      const attachFull = attachName
        ? path.join(obsidian.notePaths(CONFIG).attachmentsDir, attachName)
        : filePath;
      const note = await analyzer.analyzeVision({
        source: 'Local', sourceTag: 'local', title,
        detailUrl: '', sourceCategory: '', imagePath: attachFull, slug,
      });
      if (!note) { stats.failed++; continue; }
      if (attachName) obsidian.embedMediaInNote(note.notePath, attachName);
      // 收進 Eagle（本機檔走 addFromPath），並把 Eagle 連結寫回筆記
      if (eagleOn && folderId) {
        try {
          const annotation = [
            `作品：${title}`,
            '來源：BYO（本機）',
            ref?.obsidianUri ? `Obsidian: ${ref.obsidianUri}` : null,
            opts.runId ? `RunId: ${opts.runId}` : null,
          ].filter(Boolean).join('\n');
          const id = await addFromPath({
            path: filePath, name: title, folderId,
            tags: [...(cfg.extraTags || []), 'local'], annotation,
          });
          if (id) { try { obsidian.addEagleLinkToNote(note.notePath, `eagle://item/${id}`); } catch { /* ignore */ } }
          log(i18n.t('cli.local.addedToEagle'));
        } catch { /* 收進 Eagle 失敗不影響筆記 */ }
      }
      // 處理完移到 done/
      try {
        fs.mkdirSync(doneDir, { recursive: true });
        fs.renameSync(filePath, path.join(doneDir, f));
        log(i18n.t('cli.local.movedDone'));
      } catch { /* ignore */ }
      stats.analyzed++;
      log(i18n.t('cli.local.analyzed'));
    } catch (e) {
      log(i18n.t('cli.local.analysisError', { msg: e.message }));
      stats.failed++;
    }
  }
}

module.exports = { runFlow: runLocalFlow };
