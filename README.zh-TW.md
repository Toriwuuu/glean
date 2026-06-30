[English](README.md) | 繁體中文

# Glean

> 把**你自己**收集的設計靈感，變成可搜尋、有 AI 拆解的設計知識庫 —— 存進 Eagle 與 Obsidian。

你本來就會存下喜歡的產品與網頁設計截圖。Glean 拿你收集好的圖，用 **Claude** 幫每一張做拆解 —— 概覽、設計決策、取捨、UX 文案、takeaways —— 寫成結構化的 **Obsidian** 筆記，並和 **Eagle** 裡的圖雙向串接。日積月累，你會擁有一座能*閱讀、搜尋、借用*的個人設計庫，而不只是一堆截圖。

全程在你自己的電腦上跑。Glean **不會**爬取任何網站或藝廊 —— 放什麼進來由你決定。

---

## 怎麼餵圖給它（兩種方式）

| 模式 | 你做的事 | Glean 做的事 |
|---|---|---|
| **Eagle 資料夾**（預設） | 把圖收進指定的 Eagle 資料夾（拖拉、Eagle 瀏覽器剪藏、截圖…） | 讀那個資料夾裡「還沒分析」的項目，各寫一篇 Obsidian 筆記、串回該 Eagle 項目，並加 `glean-analyzed` tag 避免重複分析 |
| **inbox 資料夾**（不需 Eagle） | 把圖丟進 `~/Glean/inbox/` | 分析每張圖、寫筆記（嵌入圖）、有 Eagle 就把圖收進去，處理完移到 `done/` |

---

## 你需要什麼

| 項目 | 必須？ | 說明 |
|---|---|---|
| **Node.js 18+** | 必須 | 跑 Glean 本身（沒有其他套件相依） |
| **Claude Code** | 完整分析需要 | AI 拆解透過 `claude -p`；「只存圖」模式不需要。安裝：[claude.com/claude-code](https://claude.com/claude-code) |
| **Obsidian** | 建議 | 筆記是 Markdown，搭配 Obsidian（含 Base 表格）最好 |
| **Eagle** | 選用 | 本機圖片管理工具（[eagle.cool](https://eagle.cool)）。沒有的話用 inbox 模式，圖存進 Obsidian 附件 |

---

## 安裝

```bash
cd glean
npm install   # 沒有要下載的依賴，只設定 scripts
```

## 第一次跑

```bash
# inbox 模式 —— 分析你收集好的一整個資料夾
node bot.js --inbox ~/Glean/inbox

# 或依 config.json 的設定（Eagle 資料夾 / inbox）：
node bot.js

# 開本機控制台（設定、立刻跑、最近縮圖、統計）：
node bot.js --config-ui   # http://127.0.0.1:3030
```

第一次請在 `config.json` 設定你的 **Obsidian 知識庫資料夾**（或留空自動建立 `~/Documents/Glean`）。要完整 AI 分析，請先安裝並登入 Claude Code。

---

## 產出長什麼樣

每張圖，Glean 會在 `vault/<子資料夾>/<名稱>.md` 寫一篇 Obsidian 筆記：

- YAML frontmatter（標題、來源、分類、設計模式、日期）
- 正文段落（要哪些段落由你在設定決定）：概覽、值得注意的設計決策、取捨、UX 文案摘錄、takeaways、來源…
- 把圖嵌進筆記
- 與對應 Eagle 項目雙向串接（`eagle://item/...`），Eagle 項目的註記也連回筆記
- 自動產生 `*.base` 表格，讓你在 Obsidian 依來源／分類／月份／模式瀏覽全部筆記

---

## 模式

- **完整 AI 分析**（預設）：Claude 把每張圖拆成結構化筆記。需要 Claude Code。
- **只存圖**（`analysis.mode: "image"`）：不呼叫 Claude，只把圖歸檔到 Obsidian（與 Eagle），配一篇極簡筆記。沒有 Claude、或想省用量時用。

---

## 主要設定（config.json）

```jsonc
{
  "language": "zh-TW",              // 介面語言：en 或 zh-TW
  "local": {
    "enabled": true,
    "mode": "eagle",                // "eagle"＝讀 Eagle 資料夾；"inbox"＝讀本機資料夾
    "eagleSourceFolderName": "Glean Inbox", // Eagle 模式：你把圖丟進去的來源資料夾
    "eagleFolderName": "Glean",     // inbox 模式：圖收進 Eagle 的目的資料夾
    "inboxDir": "",                 // inbox 模式：本機資料夾（留空＝~/Glean/inbox）
    "analyze": true,
    "maxPerRun": 20,                // 每次最多分析幾張（控制 Claude 用量）
    "extraTags": ["glean"]
  },
  "analysis": {
    "enabled": true,
    "mode": "full",                 // full＝AI 分析；image＝只存圖
    "model": "sonnet",              // haiku / sonnet / opus
    "maxAnalysesPerRun": 20
  },
  "obsidian": { "enabled": true, "vaultDir": "", "dailySubdir": "glean" },
  "eagle": { "enabled": true }      // 關閉或連不上 → inbox/附件降級
}
```

也可以在控制台設定每日／每週自動跑。

---

## 隱私

Glean 全程在你電腦上跑，控制台只綁 `127.0.0.1`（並做 Origin/Host 檢查擋 CSRF）。唯一的對外連線是你選的 AI 模型（Claude），用於分析。你的圖片與筆記都留在自己電腦。

> 注意：控制台會載入一個 Google Fonts 字型；若想做到零外部請求，可改為自帶字型。

---

## 關於來源

Glean 刻意採 BYO：它只分析**你**收集的東西，不爬任何藝廊或訂閱服務。如果你在找「上哪收集」靈感，[Mobbin](https://mobbin.com)（真實 App／網頁 flow）和 [Eagle](https://eagle.cool)（本機素材管理）都很棒，請在它們各自的條款範圍內使用。

擷取的視覺與分析僅供**個人學習／參考**；請尊重原作者著作權，勿再散布。

## 授權

MIT —— 見 [LICENSE](LICENSE)。
