'use strict';
/**
 * lib/schedule.js — macOS launchd 自訂排程（dashboard 套用）。
 *
 * 從 bot.js 抽出：產生 launchd plist、套用（launchctl load）、描述排程文字。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const engines = require('./engines');
const CONFIG = require('./config').loadConfig();

// bot.js 在專案根目錄；本檔在 lib/ 底下，故往上一層才是根
const ROOT = path.resolve(__dirname, '..');
const LAUNCHD_LABEL = 'com.user.eagle-inspiration';
const LAUNCHD_PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LAUNCHD_LABEL}.plist`);

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function buildLaunchdPlist(schedule) {
  const hour = clamp(parseInt(schedule.hour, 10) || 9, 0, 23);
  const minute = clamp(parseInt(schedule.minute, 10) || 0, 0, 59);
  const nodePath = process.execPath;
  const nodeDir = path.dirname(nodePath);
  // 讓排程在非互動環境也能跑 claude -p（含 Mobbin MCP 的 OAuth）：PATH 要含 claude 所在資料夾
  const claudeBin = engines.resolveBin((CONFIG.analysis && CONFIG.analysis.engine) || 'claude', CONFIG.analysis && CONFIG.analysis.claudeBin);
  const claudeDir = claudeBin ? path.dirname(claudeBin) : '';
  const pathDirs = [nodeDir, claudeDir, '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean);
  let intervalXml;
  if (schedule.frequency === 'daily') {
    intervalXml = `        <key>Hour</key>\n        <integer>${hour}</integer>\n        <key>Minute</key>\n        <integer>${minute}</integer>`;
  } else if (schedule.frequency === 'monthly') {
    const day = clamp(parseInt(schedule.day, 10) || 1, 1, 28);
    intervalXml = `        <key>Day</key>\n        <integer>${day}</integer>\n        <key>Hour</key>\n        <integer>${hour}</integer>\n        <key>Minute</key>\n        <integer>${minute}</integer>`;
  } else {
    const weekday = clamp(parseInt(schedule.weekday, 10) ?? 1, 0, 6);
    intervalXml = `        <key>Weekday</key>\n        <integer>${weekday}</integer>\n        <key>Hour</key>\n        <integer>${hour}</integer>\n        <key>Minute</key>\n        <integer>${minute}</integer>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${path.join(ROOT, 'bot.js')}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${ROOT}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${pathDirs.join(':')}</string>
        <key>HOME</key>
        <string>${os.homedir()}</string>
        <key>LANG</key>
        <string>en_US.UTF-8</string>
        <key>LC_ALL</key>
        <string>en_US.UTF-8</string>
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
${intervalXml}
    </dict>
    <key>StandardOutPath</key>
    <string>${path.join(ROOT, 'logs/bot.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(ROOT, 'logs/bot.log')}</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
`;
}

function applySchedule(schedule) {
  const plist = buildLaunchdPlist(schedule);
  const launchAgents = path.join(os.homedir(), 'Library/LaunchAgents');
  if (!fs.existsSync(launchAgents)) fs.mkdirSync(launchAgents, { recursive: true });
  fs.writeFileSync(LAUNCHD_PLIST, plist);
  spawnSync('launchctl', ['unload', LAUNCHD_PLIST]);
  const r = spawnSync('launchctl', ['load', LAUNCHD_PLIST]);
  if (r.status !== 0) {
    throw new Error('launchctl load 失敗：' + (r.stderr?.toString() || `exit ${r.status}`));
  }
  return true;
}

function describeSchedule(s) {
  const hh = String(s.hour ?? 9).padStart(2, '0');
  const mm = String(s.minute ?? 0).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (s.frequency === 'daily') return `每天 ${time}`;
  if (s.frequency === 'monthly') return `每月 ${s.day ?? 1} 號 ${time}`;
  const names = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  return `每${names[s.weekday ?? 1]} ${time}`;
}

module.exports = {
  LAUNCHD_LABEL,
  LAUNCHD_PLIST,
  buildLaunchdPlist,
  clamp,
  applySchedule,
  describeSchedule,
};
