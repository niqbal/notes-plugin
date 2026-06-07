# Margin Notes

A Chrome extension for taking freeform notes directly on any webpage. Notes anchor to page content via XPath (with a text fingerprint fallback), survive refreshes, and can be saved or printed colocated with the page — like writing in the margin of a book.

## What it does

- **Click-to-place notes** anywhere on the page. Each note attaches to the nearest DOM element under the cursor.
- **Notes scroll with the page.** Cards live in a right gutter, vertically aligned with their anchor. As you scroll, every card moves with its anchor.
- **Survives refreshes.** Notes are re-anchored on load via XPath; if the page restructures and the XPath fails, a text fingerprint lookup picks up the slack.
- **Save as a self-contained HTML snapshot.** Bundles the current page + every note into one file you can keep, share, or print later.
- **Print with notes in the margin.** Both the live page and the saved snapshot print with each note next to its anchor (rather than as a separate appendix).
- **Storage that scales.** Notes live in IndexedDB owned by the background service worker — one database shared across every site you annotate.

## Install (developer mode)

1. Clone this repo.
2. Open `chrome://extensions`, toggle **Developer mode** on.
3. Click **Load unpacked** and pick the cloned folder.
4. Pin the extension if you want quick access to its toolbar icon.

See [INSTALL.md](INSTALL.md) for a guided first-use walkthrough using the bundled test page.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+M` | Show / hide the notes gutter |
| `Alt+N` | Start placing a note |
| `Esc` | Cancel placement |

## Repo layout

```
manifest.json          MV3 manifest
background.js          Service worker: storage proxy, downloads, commands
content/
  content.js           Sidebar / gutter UI, anchoring, save, print
  content.css          All content-script styles + print stylesheet
lib/
  xpath.js             XPath compute + resolve with fingerprint fallback
  storage.js           Content-script storage proxy (talks to background SW)
  idb.js               IndexedDB wrapper (runs in the SW)
popup/                 Toolbar popup
icons/                 16/48/128 PNG icons
scripts/package.sh     One-shot zip for store submission
test/                  Local test fixtures (test-page.html + harness.html)
INSTALL.md             Install & try-it guide
PUBLISHING.md          Web Store / Edge Add-ons submission walkthrough
```

## Packaging

```bash
./scripts/package.sh
```

Writes `margin-notes-<version>.zip` containing only runtime files (no docs, tests, or git metadata). See [PUBLISHING.md](PUBLISHING.md) for store submission details.

## License

MIT — see [LICENSE](LICENSE).
