// XPath utilities for anchoring notes to DOM elements.
// Computes a stable-ish XPath when a note is created and resolves it back later.

(function () {
  'use strict';

  const SKIP_TAGS = new Set(['MN-SIDEBAR', 'MN-MARKER', 'MN-ROOT']);

  function getElementIndex(el) {
    let i = 1;
    let sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === el.tagName) i++;
      sib = sib.previousElementSibling;
    }
    return i;
  }

  // Compute a robust XPath for the element. Prefers stable id attributes.
  function computeXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    if (el === document.body) return '/html/body';
    if (el === document.documentElement) return '/html';

    // Prefer id if present and looks stable (no random hashes typical of frameworks).
    if (el.id && /^[A-Za-z][\w-]{0,63}$/.test(el.id) && !/^(ember|react|ng)\d/.test(el.id)) {
      // Verify uniqueness.
      try {
        const found = document.getElementById(el.id);
        if (found === el) return `//*[@id="${el.id}"]`;
      } catch (e) {
        // fall through
      }
    }

    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE && cur !== document.documentElement) {
      const tag = cur.tagName.toLowerCase();
      const idx = getElementIndex(cur);
      parts.unshift(`${tag}[${idx}]`);
      cur = cur.parentElement;
    }
    return '/html/' + parts.join('/');
  }

  function resolveXPath(xpath) {
    if (!xpath) return null;
    try {
      const result = document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      );
      return result.singleNodeValue;
    } catch (e) {
      return null;
    }
  }

  // Pick the deepest sensible anchor element at a point — skipping our own UI.
  function pickAnchorAtPoint(x, y) {
    const stack = document.elementsFromPoint(x, y) || [];
    for (const el of stack) {
      if (!el || !el.tagName) continue;
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.closest('mn-root')) continue;
      return el;
    }
    return document.body;
  }

  // Build a short snippet of the anchor's textContent as a fallback fingerprint.
  function fingerprint(el) {
    if (!el) return '';
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    return t.slice(0, 120);
  }

  // Find an element by textContent fingerprint if XPath fails.
  function findByFingerprint(tag, snippet) {
    if (!snippet) return null;
    const lower = snippet.toLowerCase();
    const candidates = document.getElementsByTagName(tag || '*');
    for (const el of candidates) {
      if (SKIP_TAGS.has(el.tagName)) continue;
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (t.startsWith(lower)) return el;
    }
    return null;
  }

  window.MNXPath = {
    computeXPath,
    resolveXPath,
    pickAnchorAtPoint,
    fingerprint,
    findByFingerprint,
    SKIP_TAGS,
  };
})();
