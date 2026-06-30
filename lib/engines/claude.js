'use strict';
/**
 * lib/engines/claude.js — Claude Code 引擎轉接層。
 * paramsFor / buildArgs 抽成純函式以利測試；spawn 與跨平台行為一致。
 * BYO 版只做視覺分析（讀本機截圖 → 寫筆記），不再掛任何 MCP。
 */
const i18n = require('../i18n');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const isWin = process.platform === 'win32';
const ROOT = path.resolve(__dirname, '..', '..'); // lib/engines → 專案根

const ALLOWED_VISION = 'Read,Write,Edit,Glob';

// 意圖 → Claude 參數（純函式）。BYO 版只有視覺分析一種。
function paramsFor() {
  return { allowedTools: ALLOWED_VISION };
}

// 組 claude CLI 參數（純函式）。win：prompt 走 stdin。
function buildArgs({ prompt, model, allowedTools = ALLOWED_VISION, win = isWin }) {
  const args = win ? ['-p', '--model', model] : ['-p', prompt, '--model', model];
  args.push('--strict-mcp-config', '--permission-mode', 'bypassPermissions', '--allowedTools', allowedTools);
  return { args, useStdin: win };
}

// 解析 claude binary：優先用設定路徑，否則用 which/where 在 PATH 上找
function resolveBin(explicit) {
  if (explicit) return explicit;
  const finder = isWin ? 'where' : 'which';
  try {
    const r = spawnSync(finder, ['claude'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first) return first;
    }
  } catch { /* ignore */ }
  return null;
}

const splitLines = (chunk) => chunk.toString('utf8').split(/\r?\n/).filter((l) => l.length > 0);

/**
 * 跨平台呼叫 claude -p。逐行回呼 onLine，回傳 Promise<exitCode>。
 * opts: { bin, prompt, model, cwd, onLine, timeoutMs }
 */
function run({ bin, prompt, model = 'sonnet', cwd = ROOT, onLine = () => {}, timeoutMs = 5 * 60 * 1000 }) {
  const { allowedTools } = paramsFor();
  const env = { ...process.env };
  if (!isWin) { env.LANG = env.LANG || 'en_US.UTF-8'; env.LC_ALL = env.LC_ALL || 'en_US.UTF-8'; }
  const { args, useStdin } = buildArgs({ prompt, model, allowedTools });
  const child = spawn(bin, args, isWin ? { cwd, env, shell: true } : { cwd, env });
  if (useStdin) {
    if (child.stdin) {
      child.stdin.on('error', () => { /* 忽略 EPIPE */ });
      try { child.stdin.write(prompt); child.stdin.end(); } catch { /* ignore */ }
    }
  } else {
    try { child.stdin.end(); } catch { /* ignore */ }
  }
  child.stdout.on('data', (c) => splitLines(c).forEach(onLine));
  child.stderr.on('data', (c) => splitLines(c).forEach(onLine));
  return new Promise((resolve) => {
    let settled = false;
    const done = (code) => { if (!settled) { settled = true; resolve(code); } };
    const timer = setTimeout(() => {
      onLine(i18n.t('cli.engine.timeout', { seconds: Math.round(timeoutMs / 1000) }));
      try { child.kill(); } catch { /* ignore */ }
      done(124);
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      onLine(i18n.t('cli.engine.cannotRun', { msg: e.message }));
      done(1);
    });
    child.on('close', (code) => { clearTimeout(timer); done(code == null ? 1 : code); });
  });
}

module.exports = {
  id: 'claude',
  label: 'Claude Code',
  models: [
    { id: 'haiku', label: 'Haiku' },
    { id: 'sonnet', label: 'Sonnet' },
    { id: 'opus', label: 'Opus' },
  ],
  resolveBin,
  run,
  // 供測試與未來引擎參考
  paramsFor, buildArgs, ALLOWED_VISION, isWin,
};
