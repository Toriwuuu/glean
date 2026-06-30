'use strict';
/**
 * lib/analysis.js — 視覺分析調度 + 節流
 *
 * createAnalyzer({ cfg, log }) 回傳一個分析器，整個 run 共用一個實例（節流計數靠它）。
 * bot.js 在 main() 建一次，放進 flowOpts 傳給來源 flow。
 *
 *   - analyzeVision({ imagePath, title, detailUrl, ... })：讀本機圖 → Claude 視覺分析 → 寫筆記
 *   - mode=image 時只寫一篇極簡筆記（標題＋圖＋來源），不呼叫 Claude。
 *
 * 任一步失敗都回 null 並 log，不丟例外（不可中斷主流程）。
 */

const fs = require('fs');
const path = require('path');
const i18n = require('./i18n');
const engines = require('./engines');
const sections = require('./sections');
const obsidian = require('./obsidian');

const ROOT = path.resolve(__dirname, '..');
const SITE_NAMES = { local: 'Local' };

function fileMtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

function createAnalyzer({ cfg, log = () => {} }) {
  const a = (cfg && cfg.analysis) || {};
  const obs = (cfg && cfg.obsidian) || {};
  const obsidianOn = obs.enabled !== false;
  const analysisOn = a.enabled !== false;
  const imageOnly = a.mode === 'image';     // 只存圖：圖嵌進 Obsidian、不呼叫 Claude
  const notesOn = analysisOn && obsidianOn;  // 是否輸出 Obsidian 筆記（full 或 image 都算）
  const claudeOn = notesOn && !imageOnly;    // 是否真的用 Claude 分析
  const enabled = claudeOn;                  // 對外沿用語意＝完整 Claude 分析可用
  const max = Number.isFinite(a.maxAnalysesPerRun) ? a.maxAnalysesPerRun : 20;

  let used = 0;

  let bin;
  let binResolved = false;
  const getBin = () => {
    if (!binResolved) { bin = engines.resolveBin(a.engine || 'claude', a.claudeBin); binResolved = true; }
    return bin;
  };

  const canAnalyze = () => claudeOn && used < max;
  const willAnalyzeVision = () => canAnalyze();
  const willCaptureVision = () => notesOn;   // 只要要輸出筆記就處理（full 走 Claude、image 只存圖）

  // 預測筆記路徑（讓來源端在存 Eagle 前就能把 Obsidian 連結寫進 Eagle 註記）
  function refFor(title) {
    if (!notesOn) return null;
    const slug = obsidian.slugify(title);
    const notePath = obsidian.noteFile(cfg, slug);
    if (!notePath) return null;
    return { slug, notePath, obsidianUri: obsidian.obsidianUri(notePath) };
  }

  let baseEnsured = false;

  function fillPrompt(file, repl) {
    let t = fs.readFileSync(path.join(ROOT, 'prompts', file), 'utf8');
    repl['{{SECTIONS}}'] = sections.buildNoteStructure({ sections: a.sections, customSections: a.customSections });
    for (const [k, v] of Object.entries(repl)) t = t.split(k).join(v == null ? '' : String(v));
    return t;
  }

  // 共用：組 prompt → 呼叫 claude（Claude 自己 Write 筆記）→ 以「exit 0 且檔案有更新」判定成功
  async function runAndWrite({ file, repl, slug }) {
    const b = getBin();
    if (!b) { log(i18n.t('cli.analysis.noClaudeBin')); return null; }
    const p = obsidian.notePaths(cfg);
    if (!p.notesDir) { log(i18n.t('cli.analysis.noVaultDir')); return null; }
    obsidian.ensureDir(p.notesDir);
    const outPath = path.join(p.notesDir, `${slug}.md`);
    repl['{{OUTPUT_PATH}}'] = outPath;
    const before = fileMtime(outPath);
    const prompt = fillPrompt(file, repl);

    used++;
    log(i18n.t('cli.analysis.analyzing', { used, max, slug }));
    const code = await engines.runAgent(a.engine || 'claude', {
      bin: b,
      prompt,
      model: a.model || 'sonnet',
      cwd: ROOT,
      onLine: (l) => log('    │ ' + l),
    });

    const ok = code === 0 && fs.existsSync(outPath) && fileMtime(outPath) !== before;
    if (ok) {
      if (!baseEnsured) { try { obsidian.ensureBase(cfg); } catch { /* ignore */ } baseEnsured = true; }
      log(i18n.t('cli.analysis.noteWritten', { slug }));
      return { notePath: outPath, slug };
    }
    log(i18n.t('cli.analysis.noOutput', { code }));
    return null;
  }

  // 只存圖：不呼叫 Claude，寫一篇極簡筆記（標題＋圖＋來源）。給沒 Claude 的人也能收圖。
  function writeImageOnlyNote({ slug, title, liveUrl, detailUrl, sourceTag, embedName }) {
    const p = obsidian.notePaths(cfg);
    if (!p.notesDir) { log(i18n.t('cli.analysis.noVaultDirImage')); return null; }
    const date = obsidian.localDateStr();
    const month = date.slice(0, 7);
    const site = SITE_NAMES[sourceTag] || sourceTag || '';
    const src = liveUrl || detailUrl || '';
    const titleSafe = String(title || slug).replace(/[\r\n]+/g, ' ').replace(/"/g, '＂').trim();
    const body = [
      '---',
      `title: "${titleSafe}"`,
      `source: ${src}`,
      'platform: Web',
      `site: ${site}`,
      'category: 未分類',
      `date: ${date}`,
      `month: ${month}`,
      'tags:',
      `  - ${sourceTag}`,
      `  - month/${month}`,
      '---',
      '',
      `# ${titleSafe}`,
      '',
      src ? `來源：[${src}](${src})` : '',
      '',
    ].join('\n');
    const notePath = obsidian.writeNote(cfg, slug, body);
    if (!notePath) { log(i18n.t('cli.analysis.writeFail')); return null; }
    if (embedName) obsidian.embedMediaInNote(notePath, embedName);
    if (!baseEnsured) { try { obsidian.ensureBase(cfg); } catch { /* ignore */ } baseEnsured = true; }
    log(i18n.t('cli.analysis.imageSaved', { slug }));
    return { notePath, slug };
  }

  // vision 路：讀本機圖（imagePath）做 Claude 視覺分析。mode=image 時只存圖、不呼叫 Claude。
  async function analyzeVision({ source, sourceTag, title, liveUrl, detailUrl, sourceCategory, imagePath, slug: providedSlug }) {
    if (!notesOn) return null;                       // 沒要輸出筆記
    if (!imageOnly && !canAnalyze()) return null;    // 完整分析模式但已達 Claude 上限 → 跳過
    const slug = providedSlug || obsidian.slugify(title || String(detailUrl || '').replace(/^https?:\/\//, ''));

    const shotPath = imagePath || null;
    if (!shotPath) { log(i18n.t('cli.analysis.noImagePath')); return null; }

    // 只存圖模式：寫極簡筆記、不呼叫 Claude（imagePath 是本機附件檔時用它的檔名嵌入）
    if (imageOnly) {
      const emb = imagePath ? path.basename(imagePath) : null;
      return writeImageOnlyNote({ slug, title, liveUrl, detailUrl, sourceTag, embedName: emb });
    }

    const date = obsidian.localDateStr();
    return runAndWrite({
      file: 'vision-item.md',
      slug,
      repl: {
        '{{SCREENSHOT_PATH}}': shotPath,
        '{{TITLE}}': title || '',
        '{{LIVE_URL}}': liveUrl || detailUrl || '',
        '{{DETAIL_URL}}': detailUrl || '',
        '{{SOURCE_LABEL}}': source || '',
        '{{SOURCE_TAG}}': sourceTag || '',
        '{{SITE}}': SITE_NAMES[sourceTag] || sourceTag || '',
        '{{SOURCE_CATEGORY}}': sourceCategory || '',
        '{{DATE}}': date,
        '{{MONTH}}': date.slice(0, 7),
        '{{USER_ROLE}}': a.userRole || '',
        '{{AUDIENCE}}': a.audience || '',
      },
    });
  }

  return {
    enabled,
    notesOn,
    claudeOn,
    imageOnly,
    canAnalyze,
    willAnalyzeVision,
    willCaptureVision,
    refFor,
    analyzeVision,
    get used() { return used; },
    max,
  };
}

module.exports = { createAnalyzer };
