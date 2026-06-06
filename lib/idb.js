// IndexedDB wrapper for Margin Notes.
// Runs in the background service worker (extension origin), so all notes
// live in ONE database shared across every site the user annotates.
//
// Schema (DB: MarginNotes, v1):
//   ObjectStore "notes"   keyPath: id
//     index "by_page"     pageKey
//     index "by_updated"  updatedAt
//   ObjectStore "meta"    keyPath: key   (for migration flags etc.)

self.MNDB = (function () {
  'use strict';

  const DB_NAME = 'MarginNotes';
  const DB_VERSION = 1;
  const STORE_NOTES = 'notes';
  const STORE_META = 'meta';

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          const os = db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
          os.createIndex('by_page', 'pageKey', { unique: false });
          os.createIndex('by_updated', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB upgrade blocked by another connection'));
    });
    // Clear cache if connection dies so we can reopen.
    dbPromise.then(db => {
      db.onclose = () => { dbPromise = null; };
      db.onversionchange = () => { try { db.close(); } catch (e) {} dbPromise = null; };
    });
    return dbPromise;
  }

  function txWith(storeName, mode, work) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      try {
        result = work(tx.objectStore(storeName), tx);
      } catch (e) {
        reject(e);
      }
    }));
  }

  function req2promise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getNotesForPage(pageKey) {
    return txWith(STORE_NOTES, 'readonly', (store) => {
      const idx = store.index('by_page');
      return new Promise((resolve, reject) => {
        const req = idx.getAll(IDBKeyRange.only(pageKey));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  // Replace all notes for the given page with the supplied array.
  async function setNotesForPage(pageKey, notes) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NOTES, 'readwrite');
      const store = tx.objectStore(STORE_NOTES);
      const idx = store.index('by_page');
      const cursorReq = idx.openKeyCursor(IDBKeyRange.only(pageKey));
      cursorReq.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          store.delete(cur.primaryKey);
          cur.continue();
        } else {
          for (const n of notes) {
            // Ensure pageKey is set so the by_page index works.
            store.put({ ...n, pageKey });
          }
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function clearNotesForPage(pageKey) {
    return setNotesForPage(pageKey, []);
  }

  async function getStats() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NOTES, 'readonly');
      const store = tx.objectStore(STORE_NOTES);
      const idx = store.index('by_page');
      const pages = new Set();
      let count = 0;
      const req = idx.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          pages.add(cur.value.pageKey);
          count++;
          cur.continue();
        } else {
          resolve({ notes: count, pages: pages.size });
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function listPages() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NOTES, 'readonly');
      const store = tx.objectStore(STORE_NOTES);
      const idx = store.index('by_page');
      const pageMap = new Map(); // pageKey -> { count, lastUpdated }
      const req = idx.openCursor();
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          const k = cur.value.pageKey;
          const prev = pageMap.get(k) || { count: 0, lastUpdated: 0 };
          prev.count++;
          if ((cur.value.updatedAt || 0) > prev.lastUpdated) prev.lastUpdated = cur.value.updatedAt || 0;
          pageMap.set(k, prev);
          cur.continue();
        } else {
          resolve([...pageMap.entries()].map(([k, v]) => ({ pageKey: k, ...v })));
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getMeta(key) {
    return txWith(STORE_META, 'readonly', (store) => req2promise(store.get(key)));
  }

  async function setMeta(key, value) {
    return txWith(STORE_META, 'readwrite', (store) => req2promise(store.put({ key, value })));
  }

  // One-time migration: move every legacy `notes:*` entry from
  // chrome.storage.local into IndexedDB, then mark migration complete.
  async function migrateFromChromeStorage() {
    const done = await getMeta('migrated_v1');
    if (done && done.value === true) return { migrated: false, reason: 'already-done' };

    const all = await new Promise((resolve) =>
      chrome.storage.local.get(null, (res) => resolve(res || {}))
    );
    let pages = 0, notes = 0;
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith('notes:') || !Array.isArray(v) || !v.length) continue;
      await setNotesForPage(k, v);
      pages++;
      notes += v.length;
    }
    await setMeta('migrated_v1', { value: true, at: Date.now(), pages, notes });
    return { migrated: true, pages, notes };
  }

  return {
    openDB,
    getNotesForPage,
    setNotesForPage,
    clearNotesForPage,
    getStats,
    listPages,
    getMeta,
    setMeta,
    migrateFromChromeStorage,
  };
})();
