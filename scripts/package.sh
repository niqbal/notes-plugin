#!/usr/bin/env bash
# Produce a store-ready zip of the extension.
# Writes margin-notes-<version>.zip in the project root.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="margin-notes-${VERSION}.zip"

# Verify required files exist before zipping.
for f in manifest.json background.js \
         content/content.js content/content.css \
         lib/xpath.js lib/storage.js lib/idb.js \
         popup/popup.html popup/popup.js popup/popup.css \
         icons/icon16.png icons/icon48.png icons/icon128.png; do
  if [ ! -f "$f" ]; then
    echo "missing: $f" >&2
    exit 1
  fi
done

rm -f "$OUT"
zip -r "$OUT" \
  manifest.json \
  background.js \
  content/ lib/ popup/ icons/ \
  -x "*.DS_Store" "*.bak" "*.map"

# Quick report.
SIZE=$(wc -c < "$OUT")
ENTRIES=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo "wrote $OUT  ($SIZE bytes, $ENTRIES files)"
