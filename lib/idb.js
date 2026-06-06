// IndexedDB wrapper for Margin Notes.
// Runs in the background service worker (extension origin), so all notes
// live in ONE database shared across every site the user annotates.
//
// Schema (DB: MarginNotes, v1):
//   ObjectStore "notes"   keyPath: id
//     index "by_page"     pageKey
//     index "by_updated"  updatedAt

self.MNDB = (function () {
  'use strict';

  const DB_NAME = 'MarginNotes';
  const DB_VERSION = 1;
  const STORE_NOTES = 'notes';

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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IDB upgrade blocked by another connection'));
    });
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
      const pageMap = new Map();
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

  return {
    openDB,
    getNotesForPage,
    setNotesForPage,
    clearNotesForPage,
    getStats,
    listPages,
  };
})();
