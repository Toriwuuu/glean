# 任務：單一設計作品拆解（視覺分析）

你是一位設計研究者（實際身分見末端「執行環境」）。以下提供一個設計作品（通常是網站）的「截圖」與基本資訊，請拆解它的設計，寫成一篇參考筆記，存進指定路徑。請完全自動完成，不要問問題。

## 嚴格規則
- 全程禁止任何 emoji（標題、內文、清單都不行）。
- 用繁體中文撰寫（設計術語、專有名詞可保留英文）。
- 只分析「眼前這一個」作品，根據截圖與下方資訊判斷，**不要**上網搜尋或扯到別的產品。

## 步驟

### 1. 看截圖
用 Read 工具開啟這張截圖（絕對路徑）：
{{SCREENSHOT_PATH}}
仔細觀察版面結構、配色、字體、元件樣式、互動線索、資訊層級與整體調性。

### 2. 分類
依截圖與資訊，從下面這份固定清單**選一個最接近的**填入 `category`（不要自創）：
`Portfolio`, `Agency / Studio`, `SaaS / Product`, `Landing Page`, `E-Commerce`, `Editorial / Blog`, `Brand / Marketing`, `Web App / Tool`, `Experimental / Interactive`, `Crypto / Web3`, `Food / Restaurant`, `Event / Conference`, `Education`, `Portfolio / Personal`, `Other`。
再算出 `category_slug`：小寫、空格換連字號、`&` 換 `and`、`/` 兩側合併（例：`SaaS / Product` → `saas-product`）。

### 3. 設計模式（patterns）
判斷這個設計用到的網頁 UI/UX 模式，挑 **3 到 6 個**填入 `patterns`（小寫連字號）。優先從這份詞彙選用：
`hero-section`, `sticky-nav`, `mega-menu`, `bento-grid`, `card-grid`, `masonry`, `horizontal-scroll`, `scroll-animation`, `parallax`, `marquee`, `big-typography`, `split-layout`, `full-bleed-imagery`, `micro-interaction`, `cursor-effect`, `dark-mode`, `testimonial-carousel`, `pricing-table`, `faq-accordion`, `mega-footer`, `cookie-banner`, `newsletter-cta`, `case-study-grid`, `logo-wall`。

### 4. 寫筆記
用 Write 在以下「絕對路徑」建立筆記檔（若已存在就覆蓋）：
{{OUTPUT_PATH}}

檔案開頭用這個 frontmatter（`<...>` 由你填，其他保持原值）：

```
---
title: {{TITLE}} — <一句話定位>
source: {{LIVE_URL}}
platform: Web
site: {{SITE}}
category: <從固定清單選的分類>
category_slug: <category 的 slug>
patterns:
  - <pattern-slug-1>
  - <pattern-slug-2>
  - <pattern-slug-3>
date: {{DATE}}
month: {{MONTH}}
tags:
  - {{SOURCE_TAG}}
  - category/<category_slug>
  - month/{{MONTH}}
  - pattern/<pattern-slug-1>
  - pattern/<pattern-slug-2>
  - pattern/<pattern-slug-3>
---
```

frontmatter 之後，接著用以下結構撰寫正文：

{{SECTIONS}}

正文補充規則：
- 「畫面」段落：這次的截圖是本機暫存檔、不會嵌入筆記，所以**省略整個「畫面」段落**，改在「概覽」裡用一兩句描述整體視覺風格（配色、字體、版面氣質）。
- 「來源」段落：放作品標題與 Live 網址（{{LIVE_URL}}）；若另有來源頁可一併附上。

### 5. 收尾
完成後用一兩句話說明你寫了哪個作品、放在哪個檔案。

## 這個作品的資訊
- 標題：{{TITLE}}
- 來源：{{SOURCE_LABEL}}
- 該來源的分類標記（參考用）：{{SOURCE_CATEGORY}}
- Live 網址：{{LIVE_URL}}
- 來源頁：{{DETAIL_URL}}
- 平台：Web

## 執行環境
- 你的身分：{{USER_ROLE}}
- 產出服務的讀者：{{AUDIENCE}}
- 今天日期：{{DATE}}
- 月份：{{MONTH}}
- 筆記輸出絕對路徑：{{OUTPUT_PATH}}
