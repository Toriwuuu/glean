#!/usr/bin/env node
// Glean — BYO（自帶靈感）：把你收集的設計圖用 AI 拆解，存進 Eagle 與 Obsidian。
//
// 用法：
//   node bot.js                 # 依設定處理（Eagle 來源資料夾 / 本機 inbox）
//   node bot.js --inbox <path>  # 改用 inbox 模式並指定資料夾
//   node bot.js --manual-target N  # 本次最多分析 N 張
//   node bot.js --report [YYYY-MM] # 產生月報
//   node bot.js --config-ui     # 開設定控制台（http://127.0.0.1:3030）

const fs = require('fs');
const path = require('path');
const i18n = require('./lib/i18n');
const { createAnalyzer } = require('./lib/analysis');
const obsidian = require('./lib/obsidian');

// ---------- 路徑與設定 ----------
const ROOT = __dirname;
const CONFIG = require('./lib/config').loadConfig();
const LOGS_DIR = path.join(ROOT, 'logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// ---------- 橫切工具 / 模組 ----------
const { log, notify } = require('./lib/log');
const { setReady, callEagle } = require('./lib/eagle');
const { runLocalFlow } = require('./lib/sources');
const { maybeAutoGenerateLastMonthReport, generateMonthlyReport } = require('./lib/report');
const { startConfigUI } = require('./lib/dashboard');

// =====================================================================
//                          主流程
// =====================================================================

async function main() {
  i18n.setLang(CONFIG.language || 'en');
  const args = process.argv.slice(2);
  log(i18n.t('cli.start'));

  // --report [YYYY-MM]
  if (args.includes('--report')) {
    const idx = args.indexOf('--report');
    const month = args[idx + 1] && /^\d{4}-\d{2}$/.test(args[idx + 1]) ? args[idx + 1] : null;
    await generateMonthlyReport(month);
    return;
  }

  // --config-ui
  if (args.includes('--config-ui')) {
    await startConfigUI();
    return;
  }

  // --inbox <path>：改用 inbox 模式並指定資料夾
  const inboxIdx = args.indexOf('--inbox');
  if (inboxIdx >= 0) {
    CONFIG.local = CONFIG.local || {};
    CONFIG.local.mode = 'inbox';
    const p = args[inboxIdx + 1];
    if (p && !p.startsWith('--')) CONFIG.local.inboxDir = p;
  }

  // --manual-target <N>：本次最多分析幾張（覆蓋 config.local.maxPerRun）
  const mtIdx = args.indexOf('--manual-target');
  const mtRaw = mtIdx >= 0 ? parseInt(args[mtIdx + 1], 10) : null;
  const manualTarget = Number.isFinite(mtRaw) && mtRaw > 0 ? mtRaw : null;

  // Eagle 探測：連不上且可降級（有 Obsidian + 分析）就降級為「只輸出筆記」，否則中止
  if (CONFIG.eagle && CONFIG.eagle.enabled === false) {
    setReady(false);
    log(i18n.t('cli.eagle.disabled'));
  } else {
    try {
      await callEagle('get_app_info', {});
    } catch (e) {
      const canDegrade = CONFIG.obsidian && CONFIG.obsidian.enabled !== false
        && CONFIG.analysis && CONFIG.analysis.enabled !== false;
      if (canDegrade) {
        setReady(false);
        log(i18n.t('cli.eagle.degrade'));
      } else {
        log(i18n.t('cli.eagle.connectFail'), e.message);
        notify('Glean', i18n.t('cli.notify.eagleFail'));
        process.exit(1);
      }
    }
  }

  const globalStats = { local: null };
  const runId = new Date().toISOString();
  log(i18n.t('cli.runId', { runId }));

  // 建立分析器（整個 run 共用一個實例：節流計數靠它）
  const analyzer = createAnalyzer({ cfg: CONFIG, log });
  if (analyzer.notesOn) obsidian.ensureVault(CONFIG); // 留空路徑時自動建立預設知識庫
  const vaultShown = obsidian.notePaths(CONFIG).vaultDir + (CONFIG.obsidian?.vaultDir ? '' : '（自動建立）');
  if (analyzer.claudeOn) {
    log(i18n.t('cli.analysis.fullEnabled', { model: CONFIG.analysis.model, max: analyzer.max, vault: vaultShown }));
  } else if (analyzer.notesOn) {
    log(i18n.t('cli.analysis.imageOnly', { vault: vaultShown }));
  } else {
    log(i18n.t('cli.analysis.disabled'));
  }

  const flowOpts = { manual: manualTarget != null, manualTarget, runId, analyzer };
  try {
    await runLocalFlow(globalStats, flowOpts);
  } catch (e) {
    log(i18n.t('cli.local.flowError'), e.message);
  }

  // 跑完順便補上個月的月報
  try {
    await maybeAutoGenerateLastMonthReport();
  } catch (e) {
    log(i18n.t('cli.monthlyAutoFail'), e.message);
  }

  const lo = globalStats.local || { analyzed: 0 };
  notify('Glean', i18n.t('cli.notify.localDone', { analyzed: lo.analyzed }));
  log(i18n.t('cli.end'));
}

main().catch((e) => {
  log(i18n.t('cli.unexpectedError'), e.stack || e.message);
  notify('Glean', i18n.t('cli.notify.unexpectedError', { msg: e.message || i18n.t('cli.notify.gleanFail') }));
  process.exit(1);
});
