// MNStorage — content-script side.
// Proxies storage operations to the background service worker, which owns
// the IndexedDB instance. Keeping the public API identical to the old
// chrome.storage.local wrapper so content.js doesn't change.

(function () {
  'use strict';

  function pageKey(url) {
    try {
      const u = new URL(url || location.href);
      return `notes:${u.origin}${u.pathname}`;
    } catch (e) {
      return `notes:${location.href}`;
    }
  }

  function send(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (resp) => {
          void chrome.runtime.lastError;
          resolve(resp || { ok: false, error: 'no response' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  async function getNotes(url) {
    const resp = await send({ type: 'mn-storage', op: 'get', pageKey: pageKey(url) });
    return resp.ok && Array.isArray(resp.notes) ? resp.notes : [];
  }

  async function setNotes(notes, url) {
    const resp = await send({ type: 'mn-storage', op: 'set', pageKey: pageKey(url), notes });
    return !!(resp && resp.ok);
  }

  async function clearNotes(url) {
    const resp = await send({ type: 'mn-storage', op: 'clear', pageKey: pageKey(url) });
    return !!(resp && resp.ok);
  }

  async function getStats() {
    const resp = await send({ type: 'mn-storage', op: 'stats' });
    return resp.ok ? resp.stats : { notes: 0, pages: 0 };
  }

  async function listPages() {
    const resp = await send({ type: 'mn-storage', op: 'pages' });
    return resp.ok ? resp.pages : [];
  }

  // Backwards-compatible alias (older code called this).
  const allKeys = listPages;

  window.MNStorage = { pageKey, getNotes, setNotes, clearNotes, getStats, listPages, allKeys };
})();
