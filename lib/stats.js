'use strict';
/**
 * lib/stats.js — 掃 Obsidian 筆記的 frontmatter 彙整成統計（移植自 mobbin-design-digest 的 build-dashboard.js）
 *
 * 與舊版差異：回傳 JS 物件（給 /api/notes-stats 用），不寫檔、不連網路。
 * 只讀 frontmatter（title / platform / category / patterns / date / month / source / eagle）。
 */

const fs = require('fs');
const path = require('path');
const obsidian = require('./obsidian');

// 極簡 frontmatter 解析器：scalar（key: value）與 list（key: 換行後數個「  - item」）
function parseFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const lines = text.slice(3, end).split('\n');
  const data = {};
  let listKey = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { data[listKey].push(unquote(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (kv) {
      const [, key, val] = kv;
      if (val === '') { listKey = key; data[key] = []; }
      else { data[key] = unquote(val); listKey = null; }
    }
  }
  return data;
}

function unquote(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  return s;
}

function normPlatform(p) {
  const s = String(p || '').toLowerCase();
  if (s.includes('ios')) return 'iOS';
  if (s.includes('web')) return 'Web';
  return p || '未分類';
}

// 掃 notesDir 裡的 *.md（跳過 _index）→ 回傳統計物件
function scanNotesStats(notesDir) {
  let files = [];
  try { files = fs.readdirSync(notesDir).filter((f) => f.endsWith('.md') && !f.startsWith('_index')); }
  catch { files = []; }

  const notes = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(notesDir, f), 'utf8'); } catch { continue; }
    const fm = parseFrontmatter(text);
    if (fm && fm.title) { fm._file = f; notes.push(fm); }
  }

  const patternCount = {};
  const categoryCount = {};
  const monthMap = {};
  let ios = 0, web = 0, latestDate = '';

  for (const n of notes) {
    const plat = normPlatform(n.platform);
    if (plat === 'iOS') ios++; else if (plat === 'Web') web++;
    if (n.category) categoryCount[n.category] = (categoryCount[n.category] || 0) + 1;
    for (const p of n.patterns || []) if (p) patternCount[p] = (patternCount[p] || 0) + 1;
    const m = n.month || (n.date ? String(n.date).slice(0, 7) : null);
    if (m) { if (!monthMap[m]) monthMap[m] = { ios: 0, web: 0 }; if (plat === 'Web') monthMap[m].web++; else monthMap[m].ios++; }
    if (n.date && n.date > latestDate) latestDate = n.date;
  }

  const patterns = Object.entries(patternCount).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const categories = Object.entries(categoryCount).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const monthly = Object.keys(monthMap).sort().map((month) => ({
    month, ios: monthMap[month].ios, web: monthMap[month].web, total: monthMap[month].ios + monthMap[month].web,
  }));
  const recent = notes.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12)
    .map((n) => ({
      title: n.title || '(無標題)',
      category: n.category || '',
      platform: normPlatform(n.platform),
      patterns: n.patterns || [],
      date: n.date || '',
      source: n.source || '',
      eagle: n.eagle || '',
      obsidian: obsidian.obsidianUri(path.join(notesDir, n._file)) || '',
    }));

  return {
    totals: { total: notes.length, ios, web, categories: categories.length, patterns: patterns.length, months: monthly.length, latestDate },
    patterns, categories, monthly, platforms: { iOS: ios, Web: web }, recent,
  };
}

module.exports = { scanNotesStats, parseFrontmatter };
