// Popup wires buttons to messages sent to the active tab's content script.

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function send(tabId, payload) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, payload, (resp) => {
        void chrome.runtime.lastError;
        resolve(resp);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

async function refreshPageInfo() {
  const tab = await getActiveTab();
  const urlEl = document.getElementById('page-url');
  const countEl = document.getElementById('count');
  if (!tab) { urlEl.textContent = '(no tab)'; return; }
  try {
    const u = new URL(tab.url);
    urlEl.textContent = u.host + u.pathname;
  } catch (e) {
    urlEl.textContent = tab.url || '—';
  }
  const resp = await send(tab.id, { type: 'mn-list' });
  if (resp && resp.ok && Array.isArray(resp.notes)) {
    const n = resp.notes.length;
    countEl.textContent = `${n} note${n === 1 ? '' : 's'} on this page`;
  } else {
    countEl.textContent = '(content script not loaded — refresh the page)';
  }
}

async function dispatch(type) {
  const tab = await getActiveTab();
  if (!tab) return;
  await send(tab.id, { type });
  window.close();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('toggle').addEventListener('click', () => dispatch('mn-toggle'));
  document.getElementById('place').addEventListener('click', () => dispatch('mn-place'));
  document.getElementById('save').addEventListener('click', () => dispatch('mn-save'));
  document.getElementById('print').addEventListener('click', () => dispatch('mn-print'));
  document.getElementById('clear').addEventListener('click', () => dispatch('mn-clear'));
  refreshPageInfo();
});
