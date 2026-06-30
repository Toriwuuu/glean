'use strict';
/**
 * lib/report.js — 月報生成與 dashboard 預覽 / 最近項目（BYO 版）。
 *
 * 只看 BYO 的 Eagle 資料夾（local.eagleFolderName 收進的、local.eagleSourceFolderName 來源的）。
 * 時間以 Eagle 自身的時間欄位為準（BYO 的 annotation 不一定有日期）。
 */

const fs = require('fs');
const path = require('path');
const { log } = require('./log');
const i18n = require('./i18n');
const CONFIG = require('./config').loadConfig();
const { callEagle, findFolderByName } = require('./eagle');

const ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(ROOT, 'logs');

const VIDEO_RE = /^(mp4|webm|mov|m4v)$/i;

function byoFolderNames() {
  const l = CONFIG.local || {};
  return [...new Set([l.eagleFolderName, l.eagleSourceFolderName].filter(Boolean))];
}

async function byoFolderIds() {
  const names = byoFolderNames();
  if (!names.length) return [];
  const tree = await callEagle('folder_get', { getAllHierarchy: true, fullDetails: true });
  const tList = tree?.data || tree?.result || tree;
  const ids = [];
  for (const name of names) {
    const f = findFolderByName(tList, name);
    if (f) ids.push(f.id);
  }
  return ids;
}

async function collectItems(folderIds, limit) {
  const all = [];
  for (const fid of folderIds) {
    const r = await callEagle('item_get', { folders: [fid], fullDetails: true, limit });
    all.push(...(r?.data || []));
  }
  return all;
}

// Eagle 項目的加入時間（ms）：優先 Eagle 自己的時間欄位，退回 annotation 內的日期
function itemAddedMs(it) {
  if (it.modificationTime) return it.modificationTime;
  if (it.btime) return it.btime;
  if (it.importedAt) return it.importedAt;
  const m = (it.annotation || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? new Date(m[1]).getTime() : 0;
}

async function maybeAutoGenerateLastMonthReport() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const ym = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
  const reportPath = path.join(LOGS_DIR, `monthly-${ym}.md`);
  if (fs.existsSync(reportPath)) return;
  log(i18n.t('cli.report.autoHeader', { month: ym }));
  await generateMonthlyReport(ym);
}

function monthBounds(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return { startMs: new Date(year, month - 1, 1).getTime(), endMs: new Date(year, month, 1).getTime() };
}

// 算某月的 BYO 統計（generateMonthlyReport / previewMonthlyMarkdown 共用）
async function computeMonthStats(yearMonth) {
  const folderIds = await byoFolderIds();
  if (!folderIds.length) return null;
  const { startMs, endMs } = monthBounds(yearMonth);
  const items = await collectItems(folderIds, 1000);
  const filtered = items.filter((it) => { const ms = itemAddedMs(it); return ms >= startMs && ms < endMs; });

  const byKind = { video: 0, image: 0 };
  const tagCounts = {};
  const samples = [];
  for (const it of filtered) {
    const ext = (it.ext || '').toLowerCase();
    if (VIDEO_RE.test(ext)) byKind.video++; else byKind.image++;
    for (const t of (it.tags || [])) tagCounts[t] = (tagCounts[t] || 0) + 1;
    if (samples.length < 8) samples.push({ name: it.name, ext, tags: (it.tags || []).slice(0, 4) });
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return { total: filtered.length, byKind, topTags, samples };
}

async function generateMonthlyReport(yearMonth) {
  if (!yearMonth) {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    yearMonth = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`;
  }
  log(i18n.t('cli.report.header', { month: yearMonth }));
  const s = await computeMonthStats(yearMonth);
  if (!s) { log(i18n.t('cli.report.noFolders')); return; }

  const md = `# Glean monthly report ${yearMonth}

> Generated ${new Date().toISOString().slice(0, 10)} by Glean

## Overview

- ${s.total} item(s) added this month
- Videos ${s.byKind.video} · Images ${s.byKind.image}

## Top tags

${s.topTags.length ? s.topTags.map(([t, n]) => `- ${t} × ${n}`).join('\n') : '*(none)*'}

## Samples (first ${s.samples.length})

${s.samples.map((x) => `- ${x.name} · .${x.ext} · [${x.tags.join(', ')}]`).join('\n') || '*(none)*'}
`;

  const reportPath = path.join(LOGS_DIR, `monthly-${yearMonth}.md`);
  fs.writeFileSync(reportPath, md);
  log(i18n.t('cli.report.saved', { path: reportPath }));
  log(i18n.t('cli.report.summaryByo', { total: s.total }));
}

// =====================================================================
//                      Dashboard 預覽輔助
// =====================================================================

// 撈 BYO 資料夾、依 Eagle 時間遞減回近 N 天的 items（dashboard 縮圖牆用）
async function fetchRecentItems(days) {
  const folderIds = await byoFolderIds();
  if (!folderIds.length) return [];
  const all = await collectItems(folderIds, 500);
  const cutoff = Date.now() - days * 86400 * 1000;
  return all
    .map((it) => {
      const ext = (it.ext || '').toLowerCase();
      const obs = (it.annotation || '').match(/Obsidian:\s*(\S+)/);
      return {
        id: it.id,
        name: it.name,
        addedAt: itemAddedMs(it),
        ext,
        isVideo: VIDEO_RE.test(ext),
        tags: it.tags || [],
        source: 'local',
        sourceUrl: it.url || null,
        websiteUrl: obs ? obs[1] : (it.url || null),
        annotation: it.annotation || '',
      };
    })
    .filter((x) => x.addedAt >= cutoff)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 200);
}

async function previewMonthlyMarkdown(yearMonth) {
  const s = await computeMonthStats(yearMonth);
  if (!s) return `# ${yearMonth}\n\n*No BYO Eagle folder found*`;
  return `# Live monthly preview ${yearMonth}

> Computed live by the dashboard (not written to disk)

- ${s.total} item(s) added this month
- Videos ${s.byKind.video} · Images ${s.byKind.image}

## Top tags
${s.topTags.length ? s.topTags.map(([t, n]) => `- ${t} × ${n}`).join('\n') : '*(none)*'}
`;
}

module.exports = {
  maybeAutoGenerateLastMonthReport,
  generateMonthlyReport,
  fetchRecentItems,
  previewMonthlyMarkdown,
};
