# Packaging & Publishing Margin Notes

The extension is plain Manifest V3 — no bundler, no build step. To ship it you'll zip the source folder and submit it to a store. This doc walks through each option and the pre-flight checks.

## TL;DR

| Channel | Cost | Review | Reach |
|---|---|---|---|
| Chrome Web Store | $5 one-time | 1–7 days typical | All Chrome / Brave / Arc users |
| Microsoft Edge Add-ons | Free | 1–7 days | Edge users |
| Mozilla Add-ons (AMO) | Free | minutes to days | Firefox users (needs MV3 polish) |
| Self-hosted `.zip` (sideload) | Free | None | Developer-mode users only |

If you want the broadest reach with the least fuss: **Chrome Web Store first**, then mirror to **Edge Add-ons**. Firefox is a follow-up because the WebExtensions APIs aren't 1:1.

---

## 1. Pre-flight

Before zipping, verify the source is store-ready.

### Bump the version

Edit `manifest.json`:

```json
"version": "0.2.0"
```

Stores require monotonically increasing versions on resubmit.

### Trim the zip

The store cares about *what's inside the package* — extra files just bloat the upload and slow review. Build a clean zip that includes only the runtime files.

```bash
cd /Users/nawab.iqbal/work/code/notes-plugin
rm -f margin-notes.zip
zip -r margin-notes.zip \
  manifest.json background.js \
  content/ lib/ popup/ icons/ \
  -x "*.DS_Store"
```

Do **not** include: `test/`, `*.md`, `.claude/`, `.git/`, `.bak` files, the concept doc, or screenshots.

### Verify the package runs

Load the *unzipped* contents fresh in Chrome — `chrome://extensions` → Load unpacked → pick the folder. Then test on at least one real site and inspect the service worker logs (Inspect on the extension card) for errors.

### Assets the stores ask for

Every store wants:

- **Icons**: 128×128 PNG (already in `icons/icon128.png`)
- **At least 1 screenshot**: 1280×800 or 640×400 PNG/JPG. Capture the extension in action on a real page.
- **Short description**: < 132 chars. E.g. *"Freeform margin notes for any webpage. Notes anchor to content, scroll with the page, and print colocated."*
- **Detailed description**: 200–10000 chars. Cover what it does, the keyboard shortcuts, the print + snapshot features, and privacy posture.
- **Category**: Productivity
- **Privacy policy URL**: required because we use `<all_urls>` host permissions and `storage`. Even a static GitHub Pages page works. Template below.

### Privacy policy template

Store reviewers reject extensions without one if you touch user content. Sample for this extension (host on GitHub Pages or your own site):

> **Margin Notes — Privacy Policy**
>
> Margin Notes runs entirely on your device. The text of your notes, the page URLs they're attached to, and the XPath / fingerprint used to re-anchor them are stored in an IndexedDB database inside the extension's own origin. No data is sent to any remote server, telemetry endpoint, or third party. The extension requests `<all_urls>` host access so you can take notes on any page; it only reads/writes the page DOM when you interact with the toolbar or hotkeys. You can clear notes for the current page from the toolbar, or wipe all data by removing the extension.

### Justifying broad permissions

The Chrome Web Store review form asks you to justify every permission. Crib sheet:

| Permission | Justification |
|---|---|
| `<all_urls>` | Required to inject the sidebar and place notes on any page the user visits. |
| `unlimitedStorage` | Lets the IndexedDB notes store grow beyond the default quota for users with many annotated pages. |
| `activeTab` | Lets the toolbar popup target the current tab for save/print commands. |
| `scripting` | Reserved for future programmatic injection (currently unused but declared). |
| `downloads` | Used by the "Save snapshot" feature to write the self-contained HTML file. |

If you want to be conservative, drop `scripting` from the manifest until you actually use it — fewer permissions = faster review.

---

## 2. Chrome Web Store

1. Sign in at https://chrome.google.com/webstore/devconsole/ with a Google account you control.
2. Pay the one-time **$5 developer fee** (only the first time on this account).
3. Click **Add new item** → upload `margin-notes.zip`.
4. Fill in metadata (description, category, screenshots, privacy policy URL).
5. Under **Privacy practices** declare what user data you handle ("Personally identifiable information" → No; "Web history" → declare because note URLs touch this).
6. Choose a visibility (Public / Unlisted / Private) and **Submit for review**.

Review usually takes 1–3 days for new extensions, longer if you hit the `<all_urls>` broad-host queue. You'll get email if it's rejected with a remediation list.

Unlisted is a good first step — you can hand the link to a small group, watch for crash reports, then flip to Public.

---

## 3. Microsoft Edge Add-ons (free, broader reach)

Edge accepts the **same Chrome zip** unmodified.

1. Sign in at https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview
2. **Submit new extension** → upload the same `margin-notes.zip`
3. Fill metadata (similar to Chrome's form)
4. Submit. Review is typically a few days.

No dev fee.

---

## 4. Firefox (AMO) — extra work required

Firefox supports MV3 but the WebExtensions surface differs:
- `chrome.runtime.onMessage` vs `browser.runtime.onMessage`
- Service workers vs event pages
- `chrome.action.setBadge*` semantics

For a first cut, wrap calls in a small shim (`const api = self.browser || self.chrome`). The bigger lift is the **add-on signing** flow — you upload at https://addons.mozilla.org/developers/ and they auto-sign. Self-hosted Firefox extensions can also be signed without going through AMO listing.

I'd defer Firefox until the Chrome/Edge release is stable.

---

## 5. Self-host (no store)

If you want to share a build outside any store (e.g. for a small team or an internal beta):

```bash
cd /Users/nawab.iqbal/work/code/notes-plugin
zip -r margin-notes-0.2.0.zip manifest.json background.js content/ lib/ popup/ icons/ -x "*.DS_Store"
```

Users install by:
1. Unzipping locally
2. Opening `chrome://extensions`
3. Enabling Developer mode
4. **Load unpacked** → pointing at the unzipped folder

This is what you're already doing in development. You can also produce a signed `.crx` via `chromium --pack-extension=...` but unsigned `.crx` files won't install on stable Chrome — sideloading the unpacked folder is the friction-free path.

---

## 6. Updating after first release

For minor fixes:
1. Bump `manifest.json` "version"
2. Rezip
3. Upload as a new version through the same dev console
4. Reviews on updates are usually faster than the first submission

For storage-schema changes, bump `lib/idb.js`'s `DB_VERSION` and add an `onupgradeneeded` migration so existing users don't lose data.

---

## 7. Suggested rollout

1. **Now**: build the zip, sideload it yourself, run for a week. Catch issues on the sites you actually use.
2. **Week 2**: Chrome Web Store as **Unlisted**. Share the link with a handful of testers. Iterate.
3. **Week 3**: flip to Public on Chrome. Mirror to Edge.
4. **Month 2+**: Firefox port (if there's demand).

---

## Appendix — script-able zip command

If you want one-shot packaging, save this as `scripts/package.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="margin-notes-${VERSION}.zip"
rm -f "$OUT"
zip -r "$OUT" manifest.json background.js content/ lib/ popup/ icons/ -x "*.DS_Store" "*.bak"
echo "wrote $OUT"
```

`chmod +x scripts/package.sh && scripts/package.sh`
