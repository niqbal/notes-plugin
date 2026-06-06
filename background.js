// Background service worker for Margin Notes.
// Owns the IndexedDB instance, runs the one-time migration from
// chrome.storage.local, and handles all storage / download / command messages.

try { importScripts('lib/idb.js'); }
catch (e) { console.error('[MarginNotes] failed to load idb.js', e); }

let migrationPromise = null;

function ensureMigration() {
  if (!migrationPromise) {
    migrationPromise = (self.MNDB && self.MNDB.migrateFromChromeStorage())
      ? self.MNDB.migrateFromChromeStorage().catch((e) => {
          console.warn('[MarginNotes] migration failed', e);
          return { migrated: false, error: String(e) };
        })
      : Promise.resolve({ migrated: false, reason: 'no-idb' });
  }
  return migrationPromise;
}

// Kick off migration eagerly on every wake of the SW (cheap if already done).
ensureMigration();

chrome.runtime.onInstalled.addListener(() => {
  ensureMigration();
});

chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab) return;
  if (command === 'toggle-sidebar') sendToTab(tab.id, { type: 'mn-toggle' });
  else if (command === 'add-note') sendToTab(tab.id, { type: 'mn-place' });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'mn-storage') {
    handleStorage(msg).then(sendResponse).catch((e) => {
      console.error('[MarginNotes] storage op failed', e);
      sendResponse({ ok: false, error: String(e) });
    });
    return true; // async
  }

  if (msg.type === 'mn-download') {
    handleDownload(msg.filename, msg.html).then(sendResponse).catch((e) => {
      console.error('[MarginNotes] download failed', e);
      sendResponse({ ok: false, error: String(e) });
    });
    return true;
  }

  if (msg.type === 'mn-relay') {
    getActiveTab().then((tab) => {
      if (tab) sendToTab(tab.id, msg.payload, sendResponse);
      else sendResponse({ ok: false, error: 'no active tab' });
    });
    return true;
  }
});

async function handleStorage(msg) {
  await ensureMigration();
  if (!self.MNDB) return { ok: false, error: 'idb unavailable' };

  const { op, pageKey, notes } = msg;
  if (op === 'get') {
    const list = await self.MNDB.getNotesForPage(pageKey);
    return { ok: true, notes: list };
  }
  if (op === 'set') {
    await self.MNDB.setNotesForPage(pageKey, Array.isArray(notes) ? notes : []);
    return { ok: true };
  }
  if (op === 'clear') {
    await self.MNDB.clearNotesForPage(pageKey);
    return { ok: true };
  }
  if (op === 'stats') {
    const stats = await self.MNDB.getStats();
    return { ok: true, stats };
  }
  if (op === 'pages') {
    const pages = await self.MNDB.listPages();
    return { ok: true, pages };
  }
  if (op === 'migration-status') {
    const meta = await self.MNDB.getMeta('migrated_v1');
    return { ok: true, migrated: !!(meta && meta.value && meta.value.value === true), info: meta && meta.value };
  }
  return { ok: false, error: 'unknown op: ' + op };
}

async function handleDownload(filename, html) {
  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: dataUrl, filename, saveAs: false, conflictAction: 'uniquify' },
      (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve({ ok: true, id });
      }
    );
  });
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function sendToTab(tabId, msg, cb) {
  try {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      void chrome.runtime.lastError;
      if (cb) cb(resp);
    });
  } catch (e) {
    if (cb) cb({ ok: false, error: String(e) });
  }
}
