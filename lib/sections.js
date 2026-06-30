'use strict';
/**
 * lib/sections.js — 筆記章節模板（可由設定勾選／自訂）
 *
 * 移植自 mobbin-design-digest，但「畫面」與「來源」兩段改成來源中立用詞，
 * 讓 vision（網站截圖）與 Mobbin（MCP）兩條分析路都能共用。
 *
 * buildNoteStructure(cfg) 會把啟用的章節組成 prompt 裡 {{SECTIONS}} 的內容。
 * cfg 需有 { sections: string[], customSections: [{label, prompt}] }。
 */

const SECTIONS = [
  { key: 'screens', label: '畫面', lines: [
    '## 畫面',
    '（若有可嵌入的代表性畫面就放 2 到 4 張，使用 Markdown 圖片語法；圖片來源見本指令說明。若這篇沒有可嵌入的圖，就省略整段，不要放空連結。）',
  ] },
  { key: 'overview', label: '概覽', lines: [
    '## 概覽',
    '這個產品/網站是什麼、屬於哪一類、解決什麼使用情境。',
  ] },
  { key: 'flow', label: '主要 Flow', lines: [
    '## 主要 Flow',
    '1. ...',
    '（用編號步驟描述使用者怎麼一路走完一個核心任務）',
  ] },
  { key: 'mermaid', label: '流程圖（Mermaid）', lines: [
    '## 流程圖',
    '```mermaid',
    'flowchart TD',
    '    A["起點"] --> B["下一步"]',
    '```',
    '（畫一個可渲染的 Mermaid 流程圖對應「主要 Flow」。規則：用 flowchart TD；每個節點文字一律用雙引號包起來（例 A["輸入帳號"]）；判斷處用菱形節點 B{"是否登入？"} 並在連線標註條件 -->|是| / -->|否|；節點 id 用英文字母、文字用繁體中文；確保語法正確、能直接渲染。）',
  ] },
  { key: 'decisions', label: '值得關注的設計決策', lines: [
    '## 值得關注的設計決策',
    '- **<決策重點>**：做了什麼。為什麼值得注意 / 解決什麼問題。',
  ] },
  { key: 'tradeoffs', label: '取捨 / 可以更好的地方', lines: [
    '## 取捨 / 可以更好的地方',
    '- <這個設計犧牲了什麼、在什麼情境下會失效、有沒有可議之處（保持務實的批判視角，不要硬挑毛病）>',
  ] },
  { key: 'copy', label: 'UX 文案摘錄', lines: [
    '## UX 文案摘錄',
    '- 「<畫面上的原文文案>」— 為什麼這句寫得好（CTA、標題、空狀態、錯誤訊息等）。',
  ] },
  { key: 'takeaways', label: '可借用的點', lines: [
    '## 可借用的點',
    '針對「執行環境」指定的讀者，這個案例有哪些手法可以借用到他自己的專案。',
  ] },
  { key: 'projects', label: '相關專案（需 projects.md）', lines: [
    '## 相關專案',
    '- [[<連結名>]] — 這個案例的哪個手法可以用到該專案。',
    '（只有高度相關才列，最多 2 個；有列就同時在 frontmatter 的 projects 欄寫上相同 [[連結名]]。不相關就整段省略，frontmatter 也不要放 projects 欄。）',
  ] },
  { key: 'source', label: '來源', lines: [
    '## 來源',
    '- [<產品 / 網站名稱>](<來源連結>)',
    '（若有資訊可能已過時，於該處標註「（待確認）」）',
  ] },
];

const DEFAULT_KEYS = SECTIONS.map((s) => s.key);

// 給設定面板用的清單（key + label）
function sectionList() {
  return SECTIONS.map((s) => ({ key: s.key, label: s.label }));
}

// 依設定組出筆記正文結構（取代 prompt 的 {{SECTIONS}}）
function buildNoteStructure(cfg) {
  const enabled = Array.isArray(cfg && cfg.sections) && cfg.sections.length ? cfg.sections : DEFAULT_KEYS;
  const std = SECTIONS.filter((s) => enabled.includes(s.key)).map((s) => s.lines.join('\n'));
  const custom = ((cfg && cfg.customSections) || [])
    .filter((c) => c && c.label && String(c.label).trim())
    .map((c) => `## ${String(c.label).trim()}\n${(c.prompt && String(c.prompt).trim()) || ('針對這個產品，' + String(c.label).trim() + '。')}`);
  return [...std, ...custom].join('\n\n');
}

module.exports = { SECTIONS, DEFAULT_KEYS, sectionList, buildNoteStructure };
