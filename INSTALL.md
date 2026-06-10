# Margin Notes — install & try it

Chrome extension that pegs freeform notes to any webpage. Notes anchor to DOM elements via XPath, persist across refreshes, and can be saved or printed colocated with the page.

## Install (Chrome / Edge / Brave / Arc)

1. Open `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select the `notes-plugin/` directory (the one containing `manifest.json`)
5. Pin the extension if you want quick access to the toolbar icon

## Try it on the bundled test page

Open `test/test-page.html` from this repo in Chrome — drag the file into a tab, or paste the file path into the URL bar.

(You may need to allow file:// access — go to `chrome://extensions`, click the Margin Notes "Details" link, and enable **Allow access to file URLs**.)

1. Press **Alt+M** to open the sidebar
2. Click **+ Note**, then click on a paragraph or heading to anchor a note
3. Type into the note. It autosaves.
4. Refresh — notes should reappear in the same places
5. Click **Save** to download a snapshot HTML file
6. Click **Print** to see notes colocated in the right margin of the printed/PDF output

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt+M` | Toggle sidebar |
| `Alt+N` | Start placing a note |
| `Esc` (while placing) | Cancel placement |

## Files

- `manifest.json` — MV3 manifest
- `background.js` — service worker (commands, downloads)
- `content/content.js` — sidebar UI, anchoring, persistence, save, print
- `content/content.css` — sidebar + marker styles + print stylesheet
- `lib/xpath.js` — XPath compute/resolve
- `lib/storage.js` — content-script storage proxy (talks to background SW)
- `lib/idb.js` — IndexedDB wrapper owned by the background service worker
- `popup/` — toolbar popup
- `icons/` — 16/48/128 PNG icons
- `test/test-page.html` — local test page
