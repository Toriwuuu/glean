'use strict';
/**
 * lib/dashboard.js — 本機設定控制台（--config-ui）。
 *
 * 啟動 HTTP 伺服器（127.0.0.1:3030），提供設定編輯、手動觸發跑、最近縮圖、
 * 筆記統計、月報預覽、排程套用。透過 spawn 子行程跑 bot.js 來執行 BYO 流程。
 * 含 CSRF / DNS-rebinding 防護（見下方 Host/Origin 檢查）。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { log, localStamp } = require('./log');
const i18n = require('./i18n');
const CONFIG = require('./config').loadConfig();
const obsidian = require('./obsidian');
const { applySchedule, describeSchedule } = require('./schedule');
const { fetchRecentItems, previewMonthlyMarkdown } = require('./report');
const { getIsoWeek } = require('./util');

const ROOT = path.resolve(__dirname, '..');

async function startConfigUI() {
  i18n.setLang(CONFIG.language || 'en');
  const http = require('http');
  const PORT = 3030;
  const HTML_PATH = path.join(ROOT, 'dashboard.html');

  // 「立刻跑一次」用的執行狀態（記憶體中保留最近一次）
  const runState = {
    running: false,
    lines: [],
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    child: null,
    source: null,
    progress: { done: 0, total: 0 },
  };

  const MAX_LINES = 2000;
  const pushLine = (line) => {
    runState.lines.push(`[${localStamp().slice(11)}] ${line}`);
    if (runState.lines.length > MAX_LINES) runState.lines.splice(0, runState.lines.length - MAX_LINES);
  };

  // 共用的 spawn + 接 log + 維護 runState
  const beginRun = (spawnArgs, label, env, source = null) => {
    if (runState.running) return false;
    runState.running = true;
    runState.lines = [];
    runState.source = source;
    runState.startedAt = new Date().toISOString();
    runState.finishedAt = null;
    runState.exitCode = null;
    runState.progress = { done: 0, total: 0 };
    pushLine(i18n.t('cli.dashboard.runStart', { label }));
    const child = spawn(process.execPath, spawnArgs, { cwd: ROOT, env: env || process.env });
    runState.child = child;
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        const pm = line.match(/^__GLEAN_PROGRESS__ (\d+) (\d+)$/);
        if (pm) { runState.progress = { done: +pm[1], total: +pm[2] }; continue; }
        if (line) pushLine(line);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      pushLine(i18n.t('cli.dashboard.runEnd', { code }));
      runState.running = false;
      runState.exitCode = code;
      runState.finishedAt = new Date().toISOString();
      runState.child = null;
    });
    return true;
  };

  // BYO 只有一個流程：跑 bot.js（可帶本次分析上限）
  const startRun = (manualTarget = null) => {
    const spawnArgs = [path.join(ROOT, 'bot.js')];
    if (manualTarget) spawnArgs.push('--manual-target', String(manualTarget));
    return beginRun(spawnArgs, i18n.t('cli.dashboard.runLabelFull'), process.env, 'local');
  };

  const allowedHosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);

  const server = http.createServer(async (req, res) => {
    const sendJSON = (obj, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    // CSRF / DNS-rebinding 防護：儀表板雖只綁 127.0.0.1，仍可能被「你瀏覽器裡開著的
    // 惡意網頁」跨站打進來（觸發跑分、竄改 config.json）。兩道檢查擋掉：
    //   1) Host 標頭必須是本機 loopback —— 擋 DNS rebinding（惡意域名重綁到 127.0.0.1）。
    //   2) 若請求帶 Origin，必須等於儀表板自己 —— 擋一般跨站 CSRF（含 text/plain 簡單請求）。
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (!host || !allowedHosts.has(host) || (origin && !allowedOrigins.has(origin))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden: cross-origin request blocked');
      return;
    }
    try {
      if (req.method === 'GET' && req.url === '/') {
        const html = fs.readFileSync(HTML_PATH, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else if (req.method === 'GET' && req.url === '/api/config') {
        sendJSON(JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')));
      } else if (req.method === 'POST' && req.url === '/api/config') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks).toString('utf8');
        const parsed = JSON.parse(body);
        // 寫入前驗證基本結構
        if (typeof parsed !== 'object' || !parsed.local || !parsed.analysis) {
          sendJSON({ ok: false, error: '結構不完整：缺 local / analysis section' }, 400);
          return;
        }
        fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(parsed, null, 2) + '\n');
        sendJSON({ ok: true });
      } else if (req.method === 'GET' && req.url === '/api/status') {
        sendJSON({ isoWeek: getIsoWeek() });
      } else if (req.method === 'GET' && req.url.startsWith('/api/thumb')) {
        const u = new URL(req.url, 'http://x');
        const id = u.searchParams.get('id');
        if (!id) { res.writeHead(400); res.end('missing id'); return; }
        try {
          // 用 Eagle REST API（port 41595）拿縮圖的本機檔案路徑
          const eg = await fetch(`http://localhost:41595/api/item/thumbnail?id=${encodeURIComponent(id)}`);
          const json = await eg.json();
          if (json.status !== 'success' || !json.data) { res.writeHead(404); res.end('no thumb'); return; }
          const filePath = decodeURIComponent(json.data);
          if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('thumb file missing'); return; }
          const ext = path.extname(filePath).slice(1).toLowerCase();
          const mime = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
          fs.createReadStream(filePath).pipe(res);
        } catch (e) {
          res.writeHead(500); res.end(e.message);
        }
      } else if (req.method === 'GET' && req.url.startsWith('/api/recent')) {
        const u = new URL(req.url, 'http://x');
        const days = parseInt(u.searchParams.get('days') || '7', 10);
        const items = await fetchRecentItems(days);
        sendJSON({ days, items });
      } else if (req.method === 'GET' && req.url.startsWith('/api/monthly-preview')) {
        const u = new URL(req.url, 'http://x');
        const ym = u.searchParams.get('month') || new Date().toISOString().slice(0, 7);
        const md = await previewMonthlyMarkdown(ym);
        sendJSON({ month: ym, markdown: md });
      } else if (req.method === 'GET' && req.url === '/api/notes-stats') {
        const statsLib = require('./stats');
        const freshCfg = require('./config').loadConfig();
        const dir = obsidian.notePaths(freshCfg).notesDir;
        sendJSON(dir ? statsLib.scanNotesStats(dir) : { totals: { total: 0 }, patterns: [], categories: [], monthly: [], recent: [] });
      } else if (req.method === 'POST' && req.url === '/api/schedule') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks).toString('utf8');
        const schedule = JSON.parse(body);
        try {
          applySchedule(schedule);
          const cfgPath = path.join(ROOT, 'config.json');
          const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
          cfg.schedule = schedule;
          fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
          sendJSON({ ok: true, summary: describeSchedule(schedule) });
        } catch (e) {
          sendJSON({ ok: false, error: e.message }, 500);
        }
      } else if (req.method === 'POST' && req.url === '/api/run') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        let manualTarget = null;
        if (raw) {
          try {
            const body = JSON.parse(raw);
            if (body && body.manualTarget != null) {
              const n = parseInt(body.manualTarget, 10);
              if (Number.isFinite(n) && n > 0) manualTarget = n;
            }
          } catch { /* ignore body parse error */ }
        }
        const started = startRun(manualTarget);
        if (!started) {
          sendJSON({ ok: false, error: '已有任務在跑' }, 409);
        } else {
          sendJSON({ ok: true, startedAt: runState.startedAt, source: runState.source });
        }
      } else if (req.method === 'GET' && req.url.startsWith('/api/run/status')) {
        const u = new URL(req.url, 'http://x');
        const since = Math.max(0, parseInt(u.searchParams.get('since') || '0', 10));
        sendJSON({
          running: runState.running,
          source: runState.source || null,
          total: runState.lines.length,
          lines: runState.lines.slice(since),
          startedAt: runState.startedAt,
          finishedAt: runState.finishedAt,
          exitCode: runState.exitCode,
          progress: runState.progress || { done: 0, total: 0 },
        });
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    } catch (e) {
      sendJSON({ ok: false, error: e.message }, 500);
    }
  });

  const url = `http://127.0.0.1:${PORT}`;
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      log(i18n.t('cli.dashboard.portInUse', { port: PORT }));
      try { spawn('open', [url]); } catch { /* ignore */ }
      process.exit(0);
    }
    log(i18n.t('cli.dashboard.startFail', { msg: err && err.message ? err.message : err }));
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', () => {
    log(i18n.t('cli.dashboard.started', { url }));
    log(i18n.t('cli.dashboard.ctrlC'));
    try { spawn('open', [url]); } catch { /* ignore */ }
  });

  await new Promise(() => {}); // 永遠不返回
}

module.exports = { startConfigUI };
