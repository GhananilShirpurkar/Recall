# Recall

> Privacy-first history search engine. Index and search the actual text of every page you visit locally.

![demo](assets/demo.png)

---

## What it does

You read something useful a few days ago, but you can't remember the title or URL. Standard browser history search is useless because it only indexes titles and URLs.

Recall runs passively in the background, extracts the readable text content of pages you visit, and indexes it locally. Next time you search, you can query keywords from the body content of what you actually read—fully private, sandboxed, and off-grid.

---

## Install

> Load manually in Developer Mode:

1. Download the extension source files
2. Go to `chrome://extensions` → enable **Developer Mode** (top right)
3. Click **Load unpacked** → select the `recall` subdirectory containing `manifest.json`

Done. The icon appears in your toolbar.

---

## Features

- Full-text fuzzy search over the raw content of visited web pages
- Interactive popup showing matched snippets highlighted in electric lavender
- Active tab-deduplication — clicking a search result switches focus to that tab if it's already open, preventing duplicate tabs
- Inline domain exclusion — add any domain to your blocklist with two clicks, instantly wiping all its saved content from the database
- Passive content indexing — background content extraction skips headers, footers, scripts, styles, and password/login pages
- Off-grid security — runs under a strict Content Security Policy (`connect-src 'none'`) with zero network capability
- Options dashboard to calculate disk usage, customize retention periods, edit blocklists, and wipe data

---

## Stack

`Vanilla JS` · `Manifest V3` · `MiniSearch.js` · `IndexedDB` · `Chrome Storage API` · `Chrome Extension APIs`

---

## License

MIT
