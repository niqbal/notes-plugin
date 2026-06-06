# Margin Notes App — Concept Document

## The Idea

A browser tool for taking freeform notes directly on a webpage, like writing in the corner of a book. Notes live in the margin alongside the content, persist across page refreshes, and can be saved or printed together with the page.

---

## Core Requirements

- **Freeform notes** in a sidebar/margin panel, visible while browsing
- **Pegged to page sections** — notes anchor to specific content so they survive refreshes (unless the page is fully regenerated)
- **Persistent** — notes stay where you left them across sessions
- **Save page + notes together** — export as a self-contained file to avoid losing notes if the page changes
- **Print with colocated notes** — print the page with notes appearing in the margin, not as a separate document

---

## What Already Exists

### Hypothesis *(closest match)*
[Chrome Web Store](https://chromewebstore.google.com/detail/hypothesis-web-pdf-annota/bjfhmglciegochdpefhhlphglcehbmek)

- Anchors annotations to **selected text** on the page — survives reformats as long as the text exists
- Open source, free
- Collaborative (public/private annotations)
- Gold standard for "sticky to content" anchoring behavior
- Weakness: requires selecting text first; not truly freeform margin notes

### Sticky Notes Plus
[Chrome Web Store](https://chromewebstore.google.com/detail/sticky-notes-plus/gdcmnnclkneggcgjookihlggijjkdhli)

- Pins notes to x/y coordinates, persisted in local storage
- Simpler but fragile — notes drift if page layout shifts

### Beanote / Sticky Notes for Web
[Chrome Web Store](https://chromewebstore.google.com/detail/sticky-notes-for-web-%E2%80%93-an/cmlnpalhjniphleejafmpopkpfedgbcn)

- Highlight + annotate combo
- Pin button keeps notes visible on the page

---

## Key Technical Decisions

### Anchoring Strategy

| Approach | Robustness | Freeform feel |
|---|---|---|
| Anchor to selected text (Hypothesis) | High — survives reformats | Requires text selection |
| Anchor to DOM element XPath | Medium — breaks if page restructures | Freeform, click anywhere |
| Anchor to scroll position / x,y coords | Low — breaks on layout shifts | Most freeform |

**Recommended:** anchor to nearest DOM element's XPath (what Hypothesis uses under the hood) — balances robustness with freeform feel.

### Persistence
- `chrome.storage.local` for per-device storage
- Keyed by `{domain + url + anchor}` so notes are page-specific
- Optional: sync via `chrome.storage.sync` for cross-device

### Save + Archive
- "Save snapshot" exports the page HTML + injected notes as a single self-contained `.html` file the user can keep locally
- Notes are embedded as styled margin annotations in the saved file

### Print
- On print trigger, inject notes into the page as margin annotations using CSS `@media print`
- Notes render colocated with their anchor point in the printed/PDF output
- **This is a genuine gap** — no existing extension does this cleanly

---

## What to Build (Gap in the Market)

The print feature + clean save-as-HTML are underserved by every existing tool. A Chrome extension that combines:

1. Freeform margin notes (sidebar panel, quick shortcut to open)
2. XPath-based anchoring (survives refreshes)
3. "Save page + notes" as a self-contained HTML archive
4. Clean print output with notes in the margin

…does not exist as a polished product today.

---

## Next Steps

- [ ] Spec the Chrome extension manifest + permissions needed
- [ ] Design the anchoring logic (XPath capture on note creation)
- [ ] Build the sidebar UI (collapsible, color-coded notes)
- [ ] Implement print stylesheet for colocated margin rendering
- [ ] Implement "save snapshot" export
