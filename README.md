English | [繁體中文](README.zh-TW.md)

# Glean

> Turn the design inspiration **you** collect into a searchable, AI-analyzed knowledge base — in Eagle and Obsidian.

You already save screenshots of great product and web design. Glean takes the images you've gathered and uses **Claude** to break each one down — overview, design decisions, trade-offs, UX copy, takeaways — into a structured **Obsidian** note, cross-linked with the image in **Eagle**. Over time you build a personal design library you can *read, search, and borrow from* — not just a pile of screenshots.

It runs entirely on your own machine. Glean does **not** scrape any website or gallery — you decide what goes in.

---

## How you feed it (two ways)

| Mode | You do this | Glean does this |
|---|---|---|
| **Eagle folder** (default) | Collect images into a chosen Eagle folder (drag-drop, the Eagle browser clipper, screenshots…) | Reads un-analyzed items in that folder, writes an Obsidian note for each, links it back to the Eagle item, and tags the item `glean-analyzed` so it isn't redone |
| **Inbox folder** (no Eagle needed) | Drop images into `~/Glean/inbox/` | Analyzes each image, writes the note (with the image embedded), files the image into Eagle if present, then moves it to `done/` |

---

## What you need

| Item | Required? | Notes |
|---|---|---|
| **Node.js 18+** | Required | Runs Glean (no other runtime dependencies) |
| **Claude Code** | For full analysis | The AI breakdown runs via `claude -p`. Not needed in "images-only" mode. Install: [claude.com/claude-code](https://claude.com/claude-code) |
| **Obsidian** | Recommended | Notes are Markdown; pairs well with Obsidian (incl. Base tables) |
| **Eagle** | Optional | A local image manager ([eagle.cool](https://eagle.cool)). Without it, Glean uses the inbox-folder mode and saves images into Obsidian attachments |

---

## Install

```bash
cd glean
npm install   # no dependencies to download; sets up scripts
```

## First run

```bash
# Inbox mode — analyze a folder of images you collected
node bot.js --inbox ~/Glean/inbox

# Or, with your settings (Eagle folder / inbox) from config.json:
node bot.js

# Open the local dashboard (settings, run, recent thumbnails, stats):
node bot.js --config-ui   # http://127.0.0.1:3030
```

The first time, set your **Obsidian vault folder** in `config.json` (or leave it blank to auto-create `~/Documents/Glean`). For full AI analysis, install and log in to Claude Code first.

---

## What the output looks like

For each image, Glean writes an Obsidian note to `vault/<subdir>/<name>.md` with:

- YAML frontmatter (title, source, category, design patterns, date)
- Body sections (which ones is up to you in settings): Overview, notable design decisions, trade-offs, UX copy excerpts, takeaways, source…
- The image embedded in the note
- A cross-link to the matching Eagle item (`eagle://item/...`), and a link back to the note in the Eagle item's annotation
- An auto-generated `*.base` table so you can browse all notes by source / category / month / pattern in Obsidian

---

## Modes

- **Full AI analysis** (default): Claude breaks each image into a structured note. Requires Claude Code.
- **Images only** (`analysis.mode: "image"`): no Claude calls — just files the image into Obsidian (and Eagle) with a minimal note. Use it without Claude, or to save usage.

---

## Main settings (config.json)

```jsonc
{
  "language": "en",                 // UI language: en or zh-TW
  "local": {
    "enabled": true,
    "mode": "eagle",                // "eagle" = read an Eagle folder; "inbox" = read a local folder
    "eagleSourceFolderName": "Glean Inbox", // Eagle mode: the folder you drop images into
    "eagleFolderName": "Glean",     // inbox mode: where captured images are filed in Eagle
    "inboxDir": "",                 // inbox mode: local folder (blank = ~/Glean/inbox)
    "analyze": true,
    "maxPerRun": 20,                // cap analyses per run (controls Claude usage)
    "extraTags": ["glean"]
  },
  "analysis": {
    "enabled": true,
    "mode": "full",                 // full = AI analysis; image = images only
    "model": "sonnet",              // haiku / sonnet / opus
    "maxAnalysesPerRun": 20
  },
  "obsidian": { "enabled": true, "vaultDir": "", "dailySubdir": "glean" },
  "eagle": { "enabled": true }      // off or unreachable → inbox/attachments fallback
}
```

You can also schedule it to run automatically (daily / weekly) from the dashboard.

---

## Privacy

Glean runs entirely on your machine, and the dashboard binds only to `127.0.0.1` (with Origin/Host checks against CSRF). The dashboard loads no external resources — no web fonts, CDNs, or analytics; it uses system fonts. The only outbound connection is to the AI model you choose (Claude), for analysis. Your images and notes stay on your own computer.

---

## A note on sources

Glean is deliberately BYO: it analyzes what **you** collect and does not scrape any gallery or subscription service. If you're looking for great places to *find* design inspiration to collect, [Mobbin](https://mobbin.com) (real app/web flows) and [Eagle](https://eagle.cool) (local asset manager) are both excellent — please use them within their own terms.

The captured visuals and analysis are for **personal study/reference**; respect the original authors' copyright and don't republish them.

## License

MIT — see [LICENSE](LICENSE).
